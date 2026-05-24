import { EMPLOYEES, HIREABLE, VERA_ID, getEmployee } from "./employees";
import type { Company } from "./types";

export interface WorkspaceContext {
  company: Company;
  hires: string[];
  projects: { name: string; goal: string }[];
  tasks: { title: string; status: string; ownerId: string; projectName?: string }[];
}

const ROSTER_LINES = EMPLOYEES.map(
  (e) => `- ${e.id} — ${e.name}, ${e.role} (${e.department})`,
).join("\n");

/** Static, cacheable part of the system prompt for a given employee. */
export function basePersona(employeeId: string): string {
  const e = getEmployee(employeeId);
  if (e.id === VERA_ID) {
    return `${e.persona}

# The team you direct
${ROSTER_LINES}

# How to use tools
- Use create_project to open a new initiative when a goal needs its own workstream.
- Use assign_task to put a specific, single-owner deliverable on an employee. owner_id MUST be one of the ids above. Prefer the employee whose role fits the work.
- Use set_kpi to record or update a metric the founder cares about.
- Use hire_employee only when the team is missing a role needed for the goal.
- Take action first, then summarize. Do not ask permission for routine delegation; just do it and report. Escalate only genuine judgment calls (spend over budget, irreversible decisions, brand/legal risk).
- Keep replies tight: lead with what you did or recommend, then 2-5 crisp bullets. No filler, no restating the question.`;
  }
  return `${e.persona}

You report to Vera (the AI CEO) and work for a solo founder. Be concrete and useful. Keep answers tight and skimmable. If a request is outside your function, say who on the team should own it (the team includes a CTO, CMO, CFO, Head of Research, Head of Content, Head of SEO, General Counsel, and Head of Operations).`;
}

/** Dynamic workspace snapshot — small, changes per session. */
export function workspaceSnapshot(ctx: WorkspaceContext): string {
  const hires = ctx.hires
    .map((id) => getEmployee(id))
    .map((e) => `${e.name} (${e.role})`)
    .join(", ");
  const projects = ctx.projects.length
    ? ctx.projects.map((p) => `- ${p.name}: ${p.goal}`).join("\n")
    : "- (none yet)";
  const tasks = ctx.tasks.length
    ? ctx.tasks
        .slice(0, 24)
        .map(
          (t) =>
            `- [${t.status}] ${t.title} — ${getEmployee(t.ownerId).name}${
              t.projectName ? ` (${t.projectName})` : ""
            }`,
        )
        .join("\n")
    : "- (none yet)";

  return `# Current workspace
Company: ${ctx.company.name}
What it does: ${ctx.company.idea}
Stage: ${ctx.company.stage}

Hired team: ${hires || "(just you and Vera)"}

Active projects:
${projects}

Open tasks:
${tasks}`;
}

export const HIREABLE_IDS = HIREABLE.map((e) => e.id);
