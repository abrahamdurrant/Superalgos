"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, KanbanSquare, MessageSquare, RotateCcw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useStore } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ceo", label: "CEO Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: KanbanSquare },
  { href: "/team", label: "AI Team", icon: Users },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mounted = useMounted();
  const company = useStore((s) => s.company);
  const hires = useStore((s) => s.hires);
  const resetAll = useStore((s) => s.resetAll);

  return (
    <div className="flex min-h-screen bg-ink">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/8 bg-ink-900/80 px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo href="/dashboard" />
        </div>

        <div className="mt-6 rounded-xl border border-white/8 bg-ink-800/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-mist-dim">Company</p>
          <p className="mt-1 truncate font-semibold text-white">
            {mounted ? company.name : "—"}
          </p>
          <p className="mt-0.5 text-xs text-mist-dim">
            {mounted ? `${hires.length} employees · ${company.stage}` : ""}
          </p>
        </div>

        <nav className="mt-6 flex-1 space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-violet-glow/12 text-white ring-1 ring-violet-glow/25"
                    : "text-mist hover:bg-white/5 hover:text-white"
                }`}
              >
                <item.icon className={`h-[18px] w-[18px] ${active ? "text-violet-glow" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-white/8 pt-4">
          <button
            onClick={() => {
              if (confirm("Reset the workspace to an empty starting state?")) resetAll();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-mist-dim transition-colors hover:bg-white/5 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Reset workspace
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function MobileTopBar() {
  const pathname = usePathname();
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/8 bg-ink-900/85 px-4 py-3 backdrop-blur-xl lg:hidden">
      <Logo size={26} href="/dashboard" />
      <nav className="flex items-center gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={`rounded-lg p-2 ${
                active ? "bg-violet-glow/15 text-violet-glow" : "text-mist"
              }`}
            >
              <item.icon className="h-5 w-5" />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
