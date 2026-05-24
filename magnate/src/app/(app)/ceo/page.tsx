"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Square, Sparkles, Loader2, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { EMPLOYEE_MAP, VERA_ID, getEmployee } from "@/lib/employees";
import { Avatar } from "@/components/Avatar";
import { Rich } from "@/components/Rich";
import { streamChat } from "@/lib/chatClient";
import type { ChatMessage } from "@/lib/types";

const rid = () => Math.random().toString(36).slice(2, 10);

function normalizeHistory(
  msgs: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const cleaned = msgs.filter((m) => m.content.trim().length > 0);
  while (cleaned.length && cleaned[0].role === "assistant") cleaned.shift();
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of cleaned) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  return merged.slice(-12);
}

export default function CeoChatPage() {
  const mounted = useMounted();
  const messages = useStore((s) => s.messages);
  const hires = useStore((s) => s.hires);

  const [activeId, setActiveId] = useState(VERA_ID);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ranQuery = useRef(false);

  const active = getEmployee(activeId);
  const roster = [VERA_ID, ...hires].filter((id, i, a) => a.indexOf(id) === i);

  // Handle ?with= and ?q= from the dashboard / team pages.
  useEffect(() => {
    if (!mounted || ranQuery.current) return;
    ranQuery.current = true;
    const params = new URLSearchParams(window.location.search);
    const withId = params.get("with");
    const q = params.get("q");
    let starter = VERA_ID;
    if (withId && EMPLOYEE_MAP[withId]) {
      starter = withId;
      setActiveId(withId);
    }
    if (q) {
      send(q, starter);
    }
    if (withId || q) {
      window.history.replaceState({}, "", "/ceo");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function buildContext() {
    const s = useStore.getState();
    return {
      company: s.company,
      hires: s.hires,
      projects: s.projects.map((p) => ({ name: p.name, goal: p.goal })),
      tasks: s.tasks.map((t) => ({
        title: t.title,
        status: t.status,
        ownerId: t.ownerId,
        projectName: s.projects.find((p) => p.id === t.projectId)?.name,
      })),
    };
  }

  function send(text: string, employeeId = activeId) {
    const content = text.trim();
    if (!content || busy) return;

    const store = useStore.getState();
    const priorHistory = store.messages.map((m) => ({ role: m.role, content: m.content }));
    const history = normalizeHistory([...priorHistory, { role: "user" as const, content }]);

    const userMsg: ChatMessage = {
      id: rid(),
      role: "user",
      authorId: "user",
      content,
      createdAt: Date.now(),
    };
    const assistantId = rid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      authorId: employeeId,
      content: "",
      actions: [],
      pending: true,
      createdAt: Date.now() + 1,
    };
    store.addMessage(userMsg);
    store.addMessage(assistantMsg);
    setInput("");
    setBusy(true);

    let acc = "";
    const labels: string[] = [];
    const controller = new AbortController();
    abortRef.current = controller;

    streamChat(
      { employeeId, context: buildContext(), messages: history },
      {
        onText: (delta) => {
          acc += delta;
          useStore.getState().updateMessage(assistantId, { content: acc });
        },
        onAction: (action, label) => {
          const applied = useStore.getState().applyAction(action);
          labels.push(applied || label);
          useStore.getState().updateMessage(assistantId, { actions: [...labels] });
        },
        onError: (message) => {
          acc += (acc ? "\n\n" : "") + `_⚠ ${message}_`;
          useStore.getState().updateMessage(assistantId, { content: acc });
        },
        onDone: () => {
          useStore.getState().updateMessage(assistantId, { pending: false });
          setBusy(false);
          abortRef.current = null;
        },
      },
      controller.signal,
    );
  }

  function stop() {
    abortRef.current?.abort();
  }

  if (!mounted) {
    return (
      <div className="container-x max-w-3xl py-8">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-white/5" />
        <div className="mt-6 h-96 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-0px)] max-w-3xl flex-col px-4 lg:h-screen">
      {/* Header + employee switcher */}
      <div className="flex items-center gap-3 border-b border-white/8 py-4">
        <Avatar employee={active} size={42} ring={active.id === VERA_ID} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-white">{active.name}</h1>
            <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              online
            </span>
          </div>
          <p className="truncate text-xs text-mist-dim">{active.role}</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto py-3">
        {roster.map((id) => {
          const e = getEmployee(id);
          const on = id === activeId;
          return (
            <button
              key={id}
              onClick={() => setActiveId(id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${
                on
                  ? "border-violet-glow/40 bg-violet-glow/12 text-white"
                  : "border-white/8 bg-white/[0.03] text-mist hover:text-white"
              }`}
            >
              <Avatar employee={e} size={22} />
              {e.name}
            </button>
          );
        })}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto py-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {busy && <ThinkingRow employeeId={activeId} />}
      </div>

      {/* Composer */}
      <div className="border-t border-white/8 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 rounded-2xl border border-white/10 bg-ink-900/70 p-2 focus-within:border-violet-glow/40"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={`Message ${active.name}…`}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-mist-dim"
          />
          {busy ? (
            <button type="button" onClick={stop} className="btn-ghost px-3 py-2.5">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn-primary px-4 py-2.5">
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-mist-dim">
          <Sparkles className="h-3 w-3 text-violet-glow" />
          {active.id === VERA_ID
            ? "Vera can create projects, assign work, and update KPIs in real time."
            : `${active.name} works in their specialty and reports to Vera.`}
        </p>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-violet-deep to-violet-dark px-4 py-2.5 text-sm text-white shadow-glow">
          {message.content}
        </div>
      </div>
    );
  }
  const e = getEmployee(message.authorId);
  return (
    <div className="flex gap-3">
      <Avatar employee={e} size={34} ring={e.id === VERA_ID} />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-mist-dim">{e.name}</p>
        <div className="rounded-2xl rounded-tl-md border border-white/8 bg-ink-800/70 px-4 py-3">
          {message.content ? (
            <Rich text={message.content} />
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-mist-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
            </span>
          )}
        </div>
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.actions.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-glow/25 bg-violet-glow/10 px-2.5 py-1 text-xs text-violet-glow"
              >
                <Zap className="h-3 w-3" /> {a}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingRow({ employeeId }: { employeeId: string }) {
  // Only show if the last assistant message has no content yet handled in Bubble;
  // this is a subtle "still working" cue under the stream.
  void employeeId;
  return null;
}
