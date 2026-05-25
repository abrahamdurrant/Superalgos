import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { VERA_ID } from "@/lib/employees";
import {
  HIREABLE_IDS,
  WorkspaceContext,
  basePersona,
  workspaceSnapshot,
} from "@/lib/persona";
import { buildDemoScript } from "@/lib/demo";
import { listBlogPosts, publishBlogPost } from "@/lib/webflow";
import type { AgentAction, TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.MAGNATE_MODEL || "claude-opus-4-7";
const ALL_IDS = [VERA_ID, ...HIREABLE_IDS];

interface ChatBody {
  employeeId: string;
  context: WorkspaceContext;
  messages: { role: "user" | "assistant"; content: string }[];
}

const VERA_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_project",
    description:
      "Open a new initiative/workstream. Use when a goal deserves its own project to organize tasks under.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short project name (2-5 words)." },
        goal: { type: "string", description: "One sentence describing the outcome." },
      },
      required: ["name", "goal"],
    },
  },
  {
    name: "assign_task",
    description:
      "Put a single, concrete, single-owner deliverable on a teammate. Prefer the employee whose role fits the work.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative task title." },
        detail: { type: "string", description: "One sentence of context or acceptance criteria." },
        owner_id: {
          type: "string",
          enum: ALL_IDS,
          description: "The employee id who owns this task.",
        },
        project_name: {
          type: "string",
          description: "Name of the project this belongs to (create it first if needed).",
        },
        status: {
          type: "string",
          enum: ["backlog", "in_progress", "review", "done"],
          description: "Starting status. Default to backlog unless work is already underway.",
        },
      },
      required: ["title", "owner_id"],
    },
  },
  {
    name: "set_kpi",
    description: "Record or update a key metric the founder should track.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Metric name, e.g. 'Paying users'." },
        value: { type: "string", description: "Current value, e.g. '128' or '$4.2k'." },
        delta: { type: "string", description: "Optional change, e.g. '+12%'." },
      },
      required: ["label", "value"],
    },
  },
  {
    name: "hire_employee",
    description:
      "Add an AI employee to the team when a needed role is missing. Only the listed ids are hireable.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", enum: HIREABLE_IDS },
      },
      required: ["employee_id"],
    },
  },
];

const BLOG_TOOLS: Anthropic.Tool[] = [
  {
    name: "publish_blog_post",
    description:
      "Write a post to the company's Webflow blog. Creates a CMS draft by default; set publish=true only when explicitly told to go live. Provide a complete, ready-to-read post.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The post title." },
        body: {
          type: "string",
          description: "The full post content. Markdown or HTML; use headings and paragraphs.",
        },
        summary: { type: "string", description: "Optional short summary/excerpt." },
        publish: {
          type: "boolean",
          description: "true = publish live now; false (default) = save as a draft.",
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "list_blog_posts",
    description: "List recent posts already in the Webflow blog collection.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

const BLOG_TOOL_NAMES = new Set(BLOG_TOOLS.map((t) => t.name));

function toolsFor(employeeId: string): Anthropic.Tool[] {
  if (employeeId === VERA_ID) return [...VERA_TOOLS, ...BLOG_TOOLS];
  if (employeeId === "casey") return BLOG_TOOLS;
  return [];
}

function toAction(name: string, input: Record<string, unknown>): { action: AgentAction; label: string } | null {
  switch (name) {
    case "create_project":
      return {
        action: { type: "create_project", name: String(input.name), goal: String(input.goal ?? "") },
        label: `Created project "${input.name}"`,
      };
    case "assign_task": {
      const ownerId = ALL_IDS.includes(String(input.owner_id)) ? String(input.owner_id) : "dex";
      const status = (["backlog", "in_progress", "review", "done"].includes(String(input.status))
        ? input.status
        : "backlog") as TaskStatus;
      return {
        action: {
          type: "assign_task",
          title: String(input.title),
          detail: input.detail ? String(input.detail) : undefined,
          ownerId,
          projectName: input.project_name ? String(input.project_name) : undefined,
          status,
        },
        label: `Assigned "${input.title}"`,
      };
    }
    case "set_kpi":
      return {
        action: {
          type: "set_kpi",
          label: String(input.label),
          value: String(input.value),
          delta: input.delta ? String(input.delta) : undefined,
        },
        label: `Updated KPI "${input.label}"`,
      };
    case "hire_employee":
      return {
        action: { type: "hire", employeeId: String(input.employee_id) },
        label: `Hired ${input.employee_id}`,
      };
    default:
      return null;
  }
}

function sse(controller: ReadableStreamDefaultController, obj: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const { employeeId, context, messages } = body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!apiKey) {
          await runDemo(controller, employeeId, messages);
        } else {
          await runLive(controller, apiKey, employeeId, context, messages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        sse(controller, { type: "error", message });
      } finally {
        sse(controller, { type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function runDemo(
  controller: ReadableStreamDefaultController,
  employeeId: string,
  messages: ChatBody["messages"],
) {
  const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const steps = buildDemoScript({ employeeId, userText });
  for (const step of steps) {
    if (step.kind === "action") {
      const built = toActionFromDemo(step.action);
      sse(controller, { type: "action", action: built.action, label: built.label });
      await sleep(420);
    } else {
      for (const chunk of step.text.match(/[\s\S]{1,3}/g) ?? []) {
        sse(controller, { type: "text", text: chunk });
        await sleep(9);
      }
    }
  }
}

function toActionFromDemo(action: AgentAction): { action: AgentAction; label: string } {
  switch (action.type) {
    case "create_project":
      return { action, label: `Created project "${action.name}"` };
    case "assign_task":
      return { action, label: `Assigned "${action.title}"` };
    case "set_kpi":
      return { action, label: `Updated KPI "${action.label}"` };
    case "hire":
      return { action, label: `Hired ${action.employeeId}` };
    case "blog_post":
      return {
        action,
        label: `${action.status === "published" ? "Published" : "Drafted"} blog post "${action.title}"`,
      };
  }
}

async function runLive(
  controller: ReadableStreamDefaultController,
  apiKey: string,
  employeeId: string,
  context: WorkspaceContext,
  incoming: ChatBody["messages"],
) {
  const client = new Anthropic({ apiKey });
  const tools = toolsFor(employeeId);

  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: basePersona(employeeId),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: workspaceSnapshot(context) },
  ];

  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let turn = 0; turn < 6; turn++) {
    const mstream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system,
      ...(tools.length ? { tools } : {}),
      messages,
    });

    for await (const event of mstream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        sse(controller, { type: "text", text: event.delta.text });
      }
    }

    const final = await mstream.finalMessage();
    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;

      // Server-executed tools (real Webflow side effects).
      if (BLOG_TOOL_NAMES.has(block.name)) {
        if (block.name === "publish_blog_post") {
          const res = await publishBlogPost({
            title: String(input.title ?? "Untitled"),
            body: String(input.body ?? ""),
            summary: input.summary ? String(input.summary) : undefined,
            publish: Boolean(input.publish),
          });
          if (res.ok) {
            sse(controller, {
              type: "action",
              action: {
                type: "blog_post",
                title: String(input.title ?? "Untitled"),
                url: res.url,
                status: res.status ?? "draft",
              },
              label: res.message,
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: res.message,
            is_error: !res.ok,
          });
        } else {
          const res = await listBlogPosts();
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: res.message,
            is_error: !res.ok,
          });
        }
        continue;
      }

      // Client-applied tools (project / task / KPI / hire).
      const built = toAction(block.name, input);
      if (built) {
        sse(controller, { type: "action", action: built.action, label: built.label });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Done. ${built.label}.`,
        });
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Unknown tool.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }
}
