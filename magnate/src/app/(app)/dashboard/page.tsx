"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Send,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useMounted, timeAgo } from "@/lib/useMounted";
import { getEmployee } from "@/lib/employees";
import { Avatar } from "@/components/Avatar";
import type { Kpi } from "@/lib/types";

const SUGGESTIONS = [
  "Get us to 100 paying users",
  "Plan a Product Hunt launch",
  "Figure out our pricing",
  "Find our top 3 competitors",
];

export default function DashboardPage() {
  const mounted = useMounted();
  const router = useRouter();
  const [q, setQ] = useState("");

  const company = useStore((s) => s.company);
  const kpis = useStore((s) => s.kpis);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const activity = useStore((s) => s.activity);

  function ask(prompt: string) {
    const text = prompt.trim();
    if (!text) return;
    router.push(`/ceo?q=${encodeURIComponent(text)}`);
  }

  if (!mounted) return <PageSkeleton />;

  return (
    <div className="container-x max-w-6xl py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-mist-dim">Welcome back, founder</p>
          <h1 className="display mt-1 text-3xl font-semibold text-white">{company.name}</h1>
        </div>
        <Link href="/ceo" className="btn-ghost">
          <Sparkles className="h-4 w-4 text-violet-glow" /> Open CEO chat
        </Link>
      </div>

      {/* Ask Vera */}
      <div className="card mt-6 p-5">
        <div className="flex items-center gap-2 text-sm text-mist">
          <Avatar employee={getEmployee("vera")} size={28} ring />
          <span>
            Ask <span className="font-semibold text-white">Vera</span> to set something in motion
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Launch the product and convert the waitlist"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900/70 px-4 py-3 text-sm text-white outline-none placeholder:text-mist-dim focus:border-violet-glow/50"
          />
          <button type="submit" className="btn-primary px-4">
            <Send className="h-4 w-4" />
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="chip transition-colors hover:border-violet-glow/40 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <StatCard key={k.id} kpi={k} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Projects */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Active projects</h2>
            <Link href="/projects" className="text-sm text-violet-glow hover:underline">
              View board
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {projects.length === 0 && (
              <p className="text-sm text-mist-dim">No projects yet. Ask Vera to start one.</p>
            )}
            {projects.map((p) => {
              const pt = tasks.filter((t) => t.projectId === p.id);
              const done = pt.filter((t) => t.status === "done").length;
              const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
              const owners = Array.from(new Set(pt.map((t) => t.ownerId))).slice(0, 4);
              return (
                <Link
                  href="/projects"
                  key={p.id}
                  className="block rounded-xl border border-white/8 bg-ink-900/50 p-4 transition-colors hover:border-violet-glow/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{p.name}</p>
                      <p className="truncate text-sm text-mist-dim">{p.goal}</p>
                    </div>
                    <div className="flex -space-x-2">
                      {owners.map((id) => (
                        <span key={id} className="ring-2 ring-ink-800 rounded-xl">
                          <Avatar employee={getEmployee(id)} size={26} />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-glow to-violet-deep"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-mist-dim">
                      {done}/{pt.length} done
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Activity */}
        <section className="card p-5">
          <h2 className="font-semibold text-white">Recent activity</h2>
          <div className="mt-4 space-y-4">
            {activity.slice(0, 8).map((a) => {
              const e = getEmployee(a.ownerId);
              return (
                <div key={a.id} className="flex gap-3">
                  <Avatar employee={e} size={30} />
                  <div className="min-w-0">
                    <p className="text-sm text-white/90">{a.text}</p>
                    <p className="mt-0.5 text-xs text-mist-dim">
                      {e.name} · {timeAgo(a.at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            href="/ceo"
            className="mt-5 flex items-center justify-center gap-1.5 rounded-lg border border-white/8 py-2 text-sm text-mist transition-colors hover:text-white"
          >
            Direct the team <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>
    </div>
  );
}

function StatCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.trend === "down" ? TrendingDown : kpi.trend === "flat" ? Minus : TrendingUp;
  const color =
    kpi.trend === "down"
      ? "text-rose-400"
      : kpi.trend === "flat"
        ? "text-mist-dim"
        : "text-emerald-400";
  return (
    <div className="card p-4">
      <p className="text-sm text-mist-dim">{kpi.label}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="display text-2xl font-semibold text-white">{kpi.value}</span>
        {kpi.delta && (
          <span className={`flex items-center gap-1 text-xs ${color}`}>
            <Icon className="h-3.5 w-3.5" />
            {kpi.delta}
          </span>
        )}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="container-x max-w-6xl py-8">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-white/5" />
      <div className="mt-6 h-32 animate-pulse rounded-2xl bg-white/5" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    </div>
  );
}
