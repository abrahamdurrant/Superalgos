import type { AgentAction } from "./types";
import type { WorkspaceContext } from "./persona";

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onAction: (action: AgentAction, label: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export interface ChatRequest {
  employeeId: string;
  context: WorkspaceContext;
  messages: { role: "user" | "assistant"; content: string }[];
}

/** POST to /api/chat and consume the SSE stream, invoking callbacks. */
export async function streamChat(
  req: ChatRequest,
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    cb.onError(e instanceof Error ? e.message : "Network error");
    cb.onDone();
    return;
  }

  if (!res.ok || !res.body) {
    cb.onError(`Request failed (${res.status})`);
    cb.onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        let evt: {
          type: string;
          text?: string;
          action?: AgentAction;
          label?: string;
          message?: string;
        };
        try {
          evt = JSON.parse(json);
        } catch {
          continue;
        }
        if (evt.type === "text" && evt.text) cb.onText(evt.text);
        else if (evt.type === "action" && evt.action)
          cb.onAction(evt.action, evt.label ?? "Action");
        else if (evt.type === "error" && evt.message) cb.onError(evt.message);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      cb.onError(e instanceof Error ? e.message : "Stream error");
    }
  } finally {
    cb.onDone();
  }
}
