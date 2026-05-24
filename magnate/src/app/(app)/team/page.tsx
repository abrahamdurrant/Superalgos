"use client";

import Link from "next/link";
import { Check, Plus, MessageSquare, Crown } from "lucide-react";
import { useStore } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { EMPLOYEES, VERA_ID } from "@/lib/employees";
import { Avatar } from "@/components/Avatar";
import type { Employee } from "@/lib/types";

export default function TeamPage() {
  const mounted = useMounted();
  const hires = useStore((s) => s.hires);
  const hire = useStore((s) => s.hire);
  const fire = useStore((s) => s.fire);
  const logActivity = useStore((s) => s.logActivity);

  if (!mounted) {
    return (
      <div className="container-x max-w-6xl py-8">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-white/5" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  const isHired = (id: string) => id === VERA_ID || hires.includes(id);

  return (
    <div className="container-x max-w-6xl py-8">
      <div>
        <h1 className="display text-3xl font-semibold text-white">AI Team</h1>
        <p className="mt-1 text-sm text-mist-dim">
          {hires.length + 1} on the payroll · {EMPLOYEES.length - 1 - hires.length} available to hire
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EMPLOYEES.map((e) => {
          const hired = isHired(e.id);
          const isCeo = e.id === VERA_ID;
          return (
            <div
              key={e.id}
              className={`card flex flex-col p-6 ${
                isCeo ? "border-violet-glow/30" : ""
              }`}
            >
              <div className="flex items-start gap-4">
                <Avatar employee={e} size={50} ring={isCeo} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-white">{e.name}</h3>
                    {isCeo && (
                      <span className="chip border-violet-glow/30 bg-violet-glow/10 text-violet-glow">
                        <Crown className="mr-1 h-3 w-3" /> CEO
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-mist-dim">{e.role}</p>
                </div>
              </div>

              <p className="mt-4 flex-1 text-sm leading-relaxed text-mist">{e.blurb}</p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {e.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-2">
                <HireButton
                  employee={e}
                  hired={hired}
                  isCeo={isCeo}
                  onHire={() => {
                    hire(e.id);
                    logActivity(VERA_ID, `Hired ${e.name} as ${e.role}.`);
                  }}
                  onFire={() => fire(e.id)}
                />
                <Link
                  href={`/ceo?with=${e.id}`}
                  className="btn-ghost px-3"
                  aria-label={`Message ${e.name}`}
                >
                  <MessageSquare className="h-4 w-4" />
                </Link>
              </div>
              <p className="mt-3 text-xs text-mist-dim">{e.priceNote}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HireButton({
  employee,
  hired,
  isCeo,
  onHire,
  onFire,
}: {
  employee: Employee;
  hired: boolean;
  isCeo: boolean;
  onHire: () => void;
  onFire: () => void;
}) {
  if (isCeo) {
    return (
      <span className="btn-ghost flex-1 cursor-default text-emerald-300">
        <Check className="h-4 w-4" /> Always on
      </span>
    );
  }
  if (hired) {
    return (
      <button onClick={onFire} className="btn-ghost group flex-1">
        <Check className="h-4 w-4 text-emerald-400 group-hover:hidden" />
        <span className="group-hover:hidden">On the team</span>
        <span className="hidden text-rose-300 group-hover:inline">Remove</span>
      </button>
    );
  }
  return (
    <button onClick={onHire} className="btn-primary flex-1">
      <Plus className="h-4 w-4" /> Hire {employee.name}
    </button>
  );
}
