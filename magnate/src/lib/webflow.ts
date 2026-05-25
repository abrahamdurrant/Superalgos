/**
 * Minimal Webflow v2 Data API client for publishing blog posts.
 *
 * Config (set as environment variables on the host, e.g. Vercel):
 *   WEBFLOW_API_TOKEN          required — site API token with CMS read/write
 *   WEBFLOW_BLOG_COLLECTION_ID optional — pin a specific CMS collection
 *   WEBFLOW_SITE_ID            optional — pin a specific site (for discovery)
 *
 * If WEBFLOW_API_TOKEN is unset, the integration reports "not configured"
 * instead of throwing, so the rest of the app keeps working.
 */

const API = "https://api.webflow.com/v2";

export function webflowConfigured(): boolean {
  return Boolean(process.env.WEBFLOW_API_TOKEN);
}

interface WebflowField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  isRequired?: boolean;
}

interface PublishInput {
  title: string;
  body: string;
  summary?: string;
  publish?: boolean;
}

export interface BlogResult {
  ok: boolean;
  message: string;
  url?: string;
  itemId?: string;
  status?: "draft" | "published";
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

async function wfFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg =
      (json as { message?: string })?.message ||
      `Webflow API error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "post"
  );
}

/** Light markdown → HTML so RichText fields render cleanly. */
function toHtml(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return body; // already HTML
  const blocks = body.split(/\n{2,}/).map((para) => {
    const heading = para.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4); // # -> h2
      return `<h${level}>${inlineHtml(heading[2])}</h${level}>`;
    }
    return `<p>${inlineHtml(para.replace(/\n/g, "<br>"))}</p>`;
  });
  return blocks.join("");
}

function inlineHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>");
}

async function resolveCollectionId(): Promise<string> {
  const pinned = process.env.WEBFLOW_BLOG_COLLECTION_ID;
  if (pinned) return pinned;

  const sitesResp = (await wfFetch("/sites")) as { sites?: { id: string }[] };
  const sites = sitesResp.sites ?? [];
  if (sites.length === 0) throw new Error("No Webflow sites found for this token.");
  const siteId = process.env.WEBFLOW_SITE_ID || sites[0].id;

  const colResp = (await wfFetch(`/sites/${siteId}/collections`)) as {
    collections?: { id: string; displayName: string; slug: string }[];
  };
  const collections = colResp.collections ?? [];
  if (collections.length === 0)
    throw new Error("No CMS collections found on the Webflow site.");

  const match =
    collections.find((c) => /blog|post|article|news/i.test(`${c.displayName} ${c.slug}`)) ||
    collections[0];
  return match.id;
}

async function getFields(collectionId: string): Promise<WebflowField[]> {
  const resp = (await wfFetch(`/collections/${collectionId}`)) as {
    fields?: WebflowField[];
  };
  return resp.fields ?? [];
}

export async function publishBlogPost(input: PublishInput): Promise<BlogResult> {
  if (!webflowConfigured()) {
    return {
      ok: false,
      message:
        "Webflow isn't connected yet. Set the WEBFLOW_API_TOKEN environment variable (a Webflow site API token with CMS read/write) and redeploy.",
    };
  }

  try {
    const collectionId = await resolveCollectionId();
    const fields = await getFields(collectionId);

    const richField = fields.find((f) => f.type === "RichText");
    const summaryField = fields.find(
      (f) => f.type === "PlainText" && /summary|excerpt|description|intro/i.test(f.slug),
    );

    const fieldData: Record<string, string> = {
      name: input.title,
      slug: slugify(input.title),
    };
    if (richField) fieldData[richField.slug] = toHtml(input.body);
    if (summaryField && input.summary) fieldData[summaryField.slug] = input.summary;

    const publish = Boolean(input.publish);
    const endpoint = publish
      ? `/collections/${collectionId}/items/live`
      : `/collections/${collectionId}/items`;

    const created = (await wfFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ isArchived: false, isDraft: !publish, fieldData }),
    })) as { id?: string };

    const status: "draft" | "published" = publish ? "published" : "draft";
    return {
      ok: true,
      status,
      itemId: created?.id,
      message: publish
        ? `Published "${input.title}" live to the Webflow blog.`
        : `Created "${input.title}" as a draft in the Webflow CMS (publish it from Webflow when ready).`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Webflow publish failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}

export async function listBlogPosts(limit = 5): Promise<BlogResult & { posts?: string[] }> {
  if (!webflowConfigured()) {
    return { ok: false, message: "Webflow isn't connected (set WEBFLOW_API_TOKEN)." };
  }
  try {
    const collectionId = await resolveCollectionId();
    const resp = (await wfFetch(`/collections/${collectionId}/items?limit=${limit}`)) as {
      items?: { fieldData?: { name?: string } }[];
    };
    const posts = (resp.items ?? []).map((i) => i.fieldData?.name ?? "(untitled)");
    return {
      ok: true,
      posts,
      message: posts.length
        ? `Found ${posts.length} recent post(s): ${posts.join(", ")}.`
        : "No posts in the blog collection yet.",
    };
  } catch (e) {
    return {
      ok: false,
      message: `Couldn't read the Webflow blog: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
