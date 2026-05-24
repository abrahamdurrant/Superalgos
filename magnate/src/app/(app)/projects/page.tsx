"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { getEmployee } from "@/lib/employees";
import { Avatar } from "@/components/Avatar";
import type { Task, TaskStatus } from "@/lib/types";

const COLUMNS: { id: TaskStatus; label: string; accent: string }[] = [
  { id: "backlog", label: "Backlog", accent: "bg-white/20" },
  { id: "in_progress", label: "In progress", accent: "bg-violet-glow" },
  { id: "review", label: "In review", accent: "bg-amber-400" },
  { id: "done", label: "Done", accent: "bg-emerald-400" },
];

const ORDER: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

export default function ProjectsPage() {
  const mounted = useMounted();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const moveTask = useStore((s) => s.moveTask);

  if (!mounted) {
    return (
      <div className="container-x max-w-6xl py-8">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-white/5" />
        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="container-x max-w-7xl py-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="display text-3xl font-semibold text-white">Projects</h1>
          <p className="mt-1 text-sm text-mist-dim">
            {tasks.length} tasks across {projects.length} projects · {" "}
            {tasks.filter((t) => t.status === "done").length} done
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="flex flex-col">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 rounded-full ${col.accent}`} />
                <h2 className="text-sm font-semibold text-white">{col.label}</h2>
                <span className="text-xs text-mist-dim">{items.length}</span>
              </div>
              <div className="flex-1 space-y-3 rounded-2xl border border-white/8 bg-ink-900/40 p-3">
                {items.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-mist-dim">Nothing here</p>
                )}
                {items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    projectName={projectName(t.projectId)}
                    onMove={moveTask}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  projectName,
  onMove,
}: {
  task: Task;
  projectName: string;
  onMove: (id: string, status: TaskStatus) => void;
}) {
  const e = getEmployee(task.ownerId);
  const idx = ORDER.indexOf(task.status);
  const prev = idx > 0 ? ORDER[idx - 1] : null;
  const next = idx < ORDER.length - 1 ? ORDER[idx + 1] : null;

  return (
    <div className="group rounded-xl border border-white/8 bg-ink-800/80 p-3.5 shadow-card transition-colors hover:border-violet-glow/25">
      {projectName && (
        <span className="chip mb-2 max-w-full truncate">{projectName}</span>
      )}
      <p className="text-sm font-medium leading-snug text-white">{task.title}</p>
      {task.detail && <p className="mt-1 text-xs leading-relaxed text-mist-dim">{task.detail}</p>}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar employee={e} size={24} />
          <span className="text-xs text-mist">{e.name}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            disabled={!prev}
            onClick={() => prev && onMove(task.id, prev)}
            className="rounded-md border border-white/10 p-1 text-mist hover:text-white disabled:opacity-30"
            aria-label="Move back"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            disabled={!next}
            onClick={() => next && onMove(task.id, next)}
            className="rounded-md border border-white/10 p-1 text-mist hover:text-white disabled:opacity-30"
            aria-label="Move forward"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
