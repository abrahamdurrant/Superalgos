import type { AgentAction, TaskStatus } from "./types";
import { VERA_ID, getEmployee } from "./employees";

/** A scripted step in the demo stream: either streamed text or an action. */
export type DemoStep =
  | { kind: "text"; text: string }
  | { kind: "action"; action: AgentAction };

interface DemoInput {
  employeeId: string;
  userText: string;
}

function pickOwners(text: string): string[] {
  const t = text.toLowerCase();
  const owners: string[] = [];
  const add = (id: string) => {
    if (!owners.includes(id)) owners.push(id);
  };
  if (/(build|code|app|feature|ship|api|bug|deploy|engineer|mvp|product)/.test(t)) add("dex");
  if (/(market|ad|campaign|launch|growth|email|acqui|cac|funnel)/.test(t)) add("jordan");
  if (/(content|blog|article|copy|write|social|post)/.test(t)) add("casey");
  if (/(seo|rank|keyword|backlink|organic|search)/.test(t)) add("sage");
  if (/(price|pricing|revenue|finance|burn|runway|model|churn|mrr|metric|kpi)/.test(t)) add("sam");
  if (/(research|market size|competitor|customer|survey|tam)/.test(t)) add("riley");
  if (/(legal|contract|terms|privacy|policy|compliance)/.test(t)) add("mira");
  if (/(automat|integrat|ops|operation|support|tool|zapier|process)/.test(t)) add("atlas");
  if (owners.length === 0) {
    add("dex");
    add("jordan");
  }
  return owners.slice(0, 3);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function projectName(text: string): string {
  const cleaned = text.replace(/[.?!]+$/g, "").trim();
  const short = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return titleCase(short || "New initiative");
}

const TASK_TEMPLATES: Record<
  string,
  { title: (g: string) => string; detail: string; status: TaskStatus }[]
> = {
  dex: [
    { title: () => "Scope and ship the core build", detail: "Define the smallest shippable slice, then open the first PRs.", status: "in_progress" },
  ],
  jordan: [
    { title: () => "Draft the go-to-market plan", detail: "Channels, budget, hooks, and target CAC.", status: "backlog" },
  ],
  casey: [
    { title: () => "Produce launch content", detail: "Landing copy + one pillar article with a strong hook.", status: "backlog" },
  ],
  sage: [
    { title: () => "Build the SEO roadmap", detail: "Keyword clusters by intent + quick technical wins.", status: "backlog" },
  ],
  sam: [
    { title: () => "Update the model and KPIs", detail: "Refresh runway, pricing sensitivity, and the weekly numbers.", status: "in_progress" },
  ],
  riley: [
    { title: () => "Decision-ready research brief", detail: "Market size, top 5 competitors, and the 'so what'.", status: "backlog" },
  ],
  mira: [
    { title: () => "Review the key documents", detail: "ToS, privacy policy, and any open contracts.", status: "backlog" },
  ],
  atlas: [
    { title: () => "Wire up the operations stack", detail: "Connect tools and automate the repetitive work.", status: "backlog" },
  ],
};

function blogTitle(text: string): string {
  const m = text.match(/(?:about|introducing|on|announcing|titled|called)\s+(.+)/i);
  const raw = (m ? m[1] : "").replace(/[.?!]+$/g, "").trim();
  return raw ? titleCase(raw.split(/\s+/).slice(0, 8).join(" ")) : "Introducing Avaratak";
}

/** Build a believable scripted reply for demo mode (no API key). */
export function buildDemoScript({ employeeId, userText }: DemoInput): DemoStep[] {
  const steps: DemoStep[] = [];
  const t = userText.toLowerCase();

  const blogIntent = /\b(blog|post|article|publish|newsletter)\b/.test(t);
  if (blogIntent && (employeeId === VERA_ID || employeeId === "casey")) {
    const title = blogTitle(userText);
    steps.push({ kind: "text", text: `On it — drafting a post for the Webflow blog now.\n\n` });
    steps.push({ kind: "action", action: { type: "blog_post", title, status: "draft" } });
    steps.push({
      kind: "text",
      text: `Drafted **${title}** and saved it to the Webflow CMS as a draft for review.\n\n_Demo mode — set both \`ANTHROPIC_API_KEY\` and \`WEBFLOW_API_TOKEN\` and I'll write the full post and push it to your Webflow blog for real._`,
    });
    return steps;
  }

  if (employeeId !== VERA_ID) {
    const e = getEmployee(employeeId);
    steps.push({
      kind: "text",
      text: `${e.name} here. On it. Here's how I'd approach "${userText.trim()}":\n\n• First, I'd clarify the single outcome we're after and the constraint (time or budget).\n• Then I'd take the highest-leverage step in my lane — ${e.skills[0].toLowerCase()} — and bring you a draft fast.\n• I'll flag anything that needs another teammate.\n\nWant me to start on a first draft now? (This is demo mode — set ANTHROPIC_API_KEY to get my full, live response.)`,
    });
    return steps;
  }

  const goal = userText.trim();
  const owners = pickOwners(goal);
  const proj = projectName(goal);

  steps.push({
    kind: "text",
    text: `Got it. Here's the plan for "${goal}". I'm spinning up a project and putting the team on it now.\n\n`,
  });

  steps.push({
    kind: "action",
    action: { type: "create_project", name: proj, goal: goal },
  });

  for (const ownerId of owners) {
    const tmpl = TASK_TEMPLATES[ownerId][0];
    steps.push({
      kind: "action",
      action: {
        type: "assign_task",
        title: tmpl.title(goal),
        detail: tmpl.detail,
        ownerId,
        projectName: proj,
        status: tmpl.status,
      },
    });
  }

  const names = owners.map((id) => getEmployee(id).name);
  steps.push({
    kind: "text",
    text:
      `Done. I opened **${proj}** and assigned the first moves:\n\n` +
      owners
        .map((id) => {
          const e = getEmployee(id);
          return `• **${e.name}** (${e.role}) — ${TASK_TEMPLATES[id][0].detail}`;
        })
        .join("\n") +
      `\n\nI'll review progress and flag anything that needs you. The one thing I'd want from you: confirm the top priority if it's not "${proj}".\n\n_Demo mode — set ANTHROPIC_API_KEY to let me reason and act live with ${names.join(", ")} and the rest of the team._`,
  });

  return steps;
}
