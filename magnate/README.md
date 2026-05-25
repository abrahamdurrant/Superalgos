# Magnate

**Run a company of one. Command a team of hundreds.**

Magnate is an AI-CEO platform. You describe your vision; **Vera**, your AI Chief
Executive, turns it into projects, delegates to a team of specialized AI
employees (CTO, CMO, CFO, research, content, SEO, legal, ops), tracks the KPIs,
and escalates only the decisions that need you.

Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, Zustand, and the
Anthropic SDK.

---

## Run it locally

```bash
cd magnate
npm install
cp .env.example .env        # optional — see "Demo vs. live" below
npm run dev                 # http://localhost:3000
```

That's it. With no API key it runs in **demo mode** (fully explorable). Add a
key for the real, reasoning AI CEO.

### Demo vs. live

| Mode | Setup | Vera's behavior |
|------|-------|-----------------|
| **Demo** | nothing | Creates projects, assigns tasks, and routes work to the right teammate — with scripted replies. |
| **Live** | set `ANTHROPIC_API_KEY` | Vera reasons live with Claude and uses real tool calls. Bills Anthropic usage per message. |

Get a key at <https://console.anthropic.com/>. Override the model with
`MAGNATE_MODEL` (defaults to `claude-opus-4-7`).

### Connect Webflow (publish to the blog)

Vera and the Head of Content (Casey) can publish posts straight to your
Webflow blog using the **Webflow v2 Data API**.

1. In Webflow: **Site settings → Apps & integrations → API access →
   Generate API token** with **CMS read & write** scope.
2. Set the env var **`WEBFLOW_API_TOKEN`** (locally in `.env`, or in Vercel).
3. *(Optional)* pin a specific collection/site with
   `WEBFLOW_BLOG_COLLECTION_ID` / `WEBFLOW_SITE_ID`. If omitted, Magnate
   auto-discovers a collection named like "Blog"/"Posts" on your first site.

Then ask Vera (or Casey) to *"write and publish a blog post about X."* Posts are
created as **CMS drafts by default** (safe for testing) — say "publish it live"
to push it live. Without the token, the agent reports that Webflow isn't
connected instead of failing.

---

## Use it from your phone (deploy to Vercel)

The UI is fully responsive, so once it's hosted it works great in a mobile
browser. Vercel is the quickest host for a Next.js app and has a free tier.

1. Push this branch (or merge it to your default branch).
2. Go to <https://vercel.com/new> and **import this repository**.
3. **Important:** set **Root Directory** to `magnate` (this app lives in a
   subfolder). Vercel then auto-detects Next.js — leave the build settings as
   the defaults.
4. Add Environment Variables: **`ANTHROPIC_API_KEY`** (live AI CEO) and
   **`WEBFLOW_API_TOKEN`** (blog publishing). Both optional, but the app is
   only fully functional with them set.
5. Deploy. Open the `https://<your-project>.vercel.app` URL on your phone.

> If you import before merging, set Vercel's **Production Branch** to
> `claude/tycoon-app-recreation-REfYw` (Project → Settings → Git), or just merge
> the PR to `master` first.

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fabrahamdurrant%2FSuperalgos&root-directory=magnate&env=ANTHROPIC_API_KEY&envDescription=Optional%20-%20powers%20the%20live%20AI%20CEO%3B%20omit%20for%20demo%20mode&project-name=magnate&repository-name=magnate)

The button pre-fills the `magnate` root directory and prompts for the optional
`ANTHROPIC_API_KEY`.

---

## Project structure

```
magnate/
├── src/
│   ├── app/
│   │   ├── page.tsx            # redirects to /dashboard (no marketing site)
│   │   ├── (app)/              # the app
│   │   │   ├── layout.tsx      # app shell (sidebar / mobile top bar)
│   │   │   ├── dashboard/      # KPIs, projects, activity, "Ask Vera"
│   │   │   ├── ceo/            # streaming CEO chat with Vera & the team
│   │   │   ├── projects/       # kanban board
│   │   │   └── team/           # AI-employee marketplace (hire / fire)
│   │   └── api/chat/route.ts   # SSE stream: Claude + tool use, demo fallback
│   ├── components/             # Logo, Avatar, rich text
│   └── lib/                    # employees, personas, store, webflow, types, seed
```

State (company, hires, projects, tasks, chat) is persisted to `localStorage`,
so it survives refreshes on a given device. Use **Reset workspace** in the
sidebar to clear everything back to an empty Avaratak workspace.
