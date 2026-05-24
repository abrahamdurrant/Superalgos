import Link from "next/link";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Gauge,
  MessageSquare,
  Repeat,
  Sparkles,
  Workflow,
  Users,
  Building2,
} from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Avatar } from "@/components/Avatar";
import { Mark } from "@/components/Logo";
import { EMPLOYEES, HIREABLE, getEmployee } from "@/lib/employees";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-violet-radial" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-grid-faint [background-size:54px_54px] opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative">
        <SiteNav />
        <Hero />
        <PressStrip />
        <HowItWorks />
        <TeamSection />
        <Features />
        <Compare />
        <CtaBand />
        <SiteFooter />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="container-x relative pt-20 pb-16 sm:pt-28">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="animate-fade-up">
          <span className="eyebrow">
            <Sparkles className="h-3.5 w-3.5" />
            Meet Vera, your AI CEO
          </span>
          <h1 className="display mt-6 text-5xl font-semibold leading-[1.04] text-white sm:text-6xl">
            Run a company of one.
            <br />
            <span className="text-gradient">Command a team of hundreds.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
            Magnate gives you an AI Chief Executive who turns your vision into an
            operating plan — then directs a team of specialized AI employees to
            build, market, and run the business. You make the calls that matter.
            They do the work.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="btn-primary px-6 py-3 text-base">
              Found your company
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/#how" className="btn-ghost px-6 py-3 text-base">
              See how it works
            </Link>
          </div>
          <p className="mt-4 text-sm text-mist-dim">
            No credit card. Free to start. Hire your first AI employee in minutes.
          </p>
        </div>

        <BoardroomCard />
      </div>
    </section>
  );
}

function BoardroomCard() {
  const vera = getEmployee("vera");
  const team = HIREABLE.slice(0, 6);
  return (
    <div className="relative animate-fade-up [animation-delay:120ms]">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-violet-glow/20 blur-3xl" />
      <div className="card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar employee={vera} size={46} ring />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white">Vera</p>
                <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                  online
                </span>
              </div>
              <p className="text-xs text-mist-dim">AI Chief Executive</p>
            </div>
          </div>
          <Mark size={26} />
        </div>

        <div className="mt-5 rounded-xl border border-white/8 bg-ink-900/60 p-4">
          <p className="text-xs uppercase tracking-wider text-violet-glow">
            Now executing
          </p>
          <p className="mt-1.5 text-sm text-mist">
            “Launch the product and convert the waitlist.”
          </p>
          <div className="mt-3 space-y-2">
            <TaskLine owner="dex" text="Ship quiz-generation v1" status="In progress" />
            <TaskLine owner="jordan" text="Launch-week email sequence" status="In review" />
            <TaskLine owner="casey" text="Pillar SEO article" status="In progress" />
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs text-mist-dim">Your team</p>
          <div className="flex flex-wrap gap-2">
            {team.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] py-1 pl-1 pr-3"
              >
                <Avatar employee={e} size={24} />
                <span className="text-xs text-mist">{e.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 rounded-full border border-violet-glow/30 bg-violet-glow/10 px-3 py-1 text-xs text-violet-glow">
              <Users className="h-3.5 w-3.5" /> +994 more
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskLine({ owner, text, status }: { owner: string; text: string; status: string }) {
  const e = getEmployee(owner);
  return (
    <div className="flex items-center gap-2.5">
      <Avatar employee={e} size={22} />
      <span className="flex-1 truncate text-sm text-white/90">{text}</span>
      <span className="chip">{status}</span>
    </div>
  );
}

function PressStrip() {
  const names = ["FORTUNE", "Inc.", "Forbes", "TechCrunch", "Product Hunt"];
  return (
    <section className="container-x pb-10">
      <p className="text-center text-xs uppercase tracking-[0.2em] text-mist-dim">
        The one-person company is the future of business
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-60">
        {names.map((n) => (
          <span key={n} className="text-lg font-semibold tracking-tight text-mist">
            {n}
          </span>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  {
    icon: MessageSquare,
    title: "Describe your vision",
    body: "Tell Vera your idea or goal in plain language. She asks the right questions and turns it into a plan.",
  },
  {
    icon: Workflow,
    title: "Vera breaks it down",
    body: "Your AI CEO splits the work into projects and tasks, then assigns each to the right AI employee.",
  },
  {
    icon: Users,
    title: "The team executes",
    body: "AI specialists ship code, run campaigns, write content, and crunch the numbers — in parallel.",
  },
  {
    icon: Gauge,
    title: "She watches the metrics",
    body: "Vera tracks KPIs, spots bottlenecks, and escalates only the decisions that genuinely need you.",
  },
  {
    icon: Repeat,
    title: "Iterate every week",
    body: "Review the numbers, check the competition, retrain the team, and compound your progress.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="container-x scroll-mt-20 py-20">
      <SectionHeader
        eyebrow="How it works"
        title="You set the direction. Vera runs the company."
        sub="From a one-line idea to a working business — Magnate closes the loop between strategy and execution."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="card group p-6 transition-colors hover:border-violet-glow/30">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-glow/12 text-violet-glow ring-1 ring-violet-glow/20">
                <s.icon className="h-5 w-5" />
              </div>
              <span className="text-2xl font-semibold text-white/10">0{i + 1}</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mist">{s.body}</p>
          </div>
        ))}
        <div className="card flex flex-col justify-between bg-gradient-to-br from-violet-deep/30 to-ink-800 p-6">
          <div>
            <h3 className="display text-xl font-semibold text-white">
              A whole org, on day one.
            </h3>
            <p className="mt-2 text-sm text-mist">
              No hiring, no payroll, no management overhead. Just outcomes.
            </p>
          </div>
          <Link href="/dashboard" className="btn-primary mt-6 self-start">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function TeamSection() {
  return (
    <section id="team" className="container-x scroll-mt-20 py-20">
      <SectionHeader
        eyebrow="The team"
        title="Hire a C-suite and the staff to match"
        sub="Every employee is pre-trained for their role and knows your business. Bring on exactly who you need, when you need them."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EMPLOYEES.map((e) => (
          <div
            key={e.id}
            className="card group relative overflow-hidden p-6 transition-transform duration-200 hover:-translate-y-0.5 hover:border-violet-glow/30"
          >
            <div className="flex items-start gap-4">
              <Avatar employee={e} size={48} ring={e.id === "vera"} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-white">{e.name}</h3>
                  {e.id === "vera" && (
                    <span className="chip border-violet-glow/30 bg-violet-glow/10 text-violet-glow">
                      CEO
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-mist-dim">{e.role}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-mist">{e.tagline}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {e.skills.slice(0, 3).map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-4 text-xs text-mist-dim">{e.priceNote}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Brain,
    title: "Persistent context",
    body: "Your positioning, pricing, and brand voice live in one workspace. The whole team reuses it — no re-explaining.",
  },
  {
    icon: Workflow,
    title: "Projects & tasks",
    body: "Every deliverable has one owner and one visible status. Watch work move from backlog to done in real time.",
  },
  {
    icon: Gauge,
    title: "KPI command center",
    body: "Vera tracks the metrics that matter, flags what's slipping, and turns numbers into next steps.",
  },
  {
    icon: MessageSquare,
    title: "Talk anywhere",
    body: "Message your team from the web, or pipe them into iMessage, Slack, and Discord. Your company in your pocket.",
  },
  {
    icon: Users,
    title: "Scale to 1,000 agents",
    body: "Run a single specialist or a thousand agents in parallel. Magnate orchestrates the whole org.",
  },
  {
    icon: Building2,
    title: "Bring humans too",
    body: "Invite human teammates to work alongside your AI employees when you want a person in the loop.",
  },
];

function Features() {
  return (
    <section className="container-x py-20">
      <SectionHeader
        eyebrow="The platform"
        title="An operating system for one"
        sub="Everything you need to run a real company — minus the headcount."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-glow/12 text-violet-glow ring-1 ring-violet-glow/20">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mist">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const COMPARE_ROWS: [string, boolean, boolean, boolean][] = [
  ["Decides what to work on", true, false, true],
  ["Does the actual work", true, false, true],
  ["Runs 24/7 in parallel", true, true, false],
  ["Knows your whole business", true, false, true],
  ["No hiring, payroll, or HR", true, true, false],
  ["Costs less than one salary", true, true, false],
];

function Compare() {
  return (
    <section id="compare" className="container-x scroll-mt-20 py-20">
      <SectionHeader
        eyebrow="Why Magnate"
        title="Not another automation tool. A company."
        sub="Zapier connects apps. Hiring is slow and expensive. Magnate gives you judgment and execution together."
      />
      <div className="mt-12 overflow-hidden rounded-2xl border border-white/8">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-ink-800">
              <th className="px-5 py-4 font-medium text-mist-dim">Capability</th>
              <th className="px-5 py-4 text-center font-semibold text-violet-glow">Magnate</th>
              <th className="px-5 py-4 text-center font-medium text-mist">Automation tools</th>
              <th className="px-5 py-4 text-center font-medium text-mist">Hiring a team</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(([label, a, b, c], i) => (
              <tr key={label} className={i % 2 ? "bg-ink-900/40" : "bg-transparent"}>
                <td className="px-5 py-4 text-white/90">{label}</td>
                <Cell on={a} highlight />
                <Cell on={b} />
                <Cell on={c} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ on, highlight = false }: { on: boolean; highlight?: boolean }) {
  return (
    <td className="px-5 py-4 text-center">
      {on ? (
        <CheckCircle2
          className={`mx-auto h-5 w-5 ${highlight ? "text-violet-glow" : "text-emerald-400"}`}
        />
      ) : (
        <span className="mx-auto block h-1 w-4 rounded-full bg-white/15" />
      )}
    </td>
  );
}

function CtaBand() {
  return (
    <section className="container-x py-20">
      <div className="relative overflow-hidden rounded-3xl border border-violet-glow/20 bg-gradient-to-br from-violet-deep/40 via-ink-800 to-ink-800 p-10 text-center sm:p-16">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-glow/30 blur-3xl" />
        <h2 className="display relative text-4xl font-semibold text-white sm:text-5xl">
          Your empire is one message away.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-mist">
          Tell Vera what you want to build. She'll have the team on it before you
          finish your coffee.
        </p>
        <div className="relative mt-8 flex justify-center">
          <Link href="/dashboard" className="btn-primary px-7 py-3.5 text-base">
            Found your company free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="display mt-5 text-3xl font-semibold text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-mist">{sub}</p>
    </div>
  );
}
