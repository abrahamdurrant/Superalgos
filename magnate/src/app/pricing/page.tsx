import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

const TIERS = [
  {
    name: "Founder",
    price: "$0",
    cadence: "forever",
    blurb: "Meet Vera and get your first projects moving.",
    features: [
      "Vera, your AI CEO",
      "1 active AI employee",
      "Up to 3 projects",
      "Web workspace",
      "Community support",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Operator",
    price: "$49",
    cadence: "per month",
    blurb: "A full C-suite for the serious solo founder.",
    features: [
      "Everything in Founder",
      "Up to 8 AI employees",
      "Unlimited projects & tasks",
      "KPI command center",
      "iMessage, Slack & Discord",
      "Custom agents",
    ],
    cta: "Build your empire",
    highlight: true,
  },
  {
    name: "Magnate",
    price: "$199",
    cadence: "per month",
    blurb: "Scale to a thousand agents working in parallel.",
    features: [
      "Everything in Operator",
      "Up to 1,000 parallel agents",
      "Invite human teammates",
      "Priority model access",
      "Advanced analytics",
      "Dedicated success manager",
    ],
    cta: "Go Magnate",
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-violet-radial" />
      <div className="relative">
        <SiteNav />
        <section className="container-x py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Pricing</span>
            <h1 className="display mt-5 text-4xl font-semibold text-white sm:text-5xl">
              Less than a single hire. More than a whole team.
            </h1>
            <p className="mt-4 text-mist">
              Start free. Scale when the company does. No credit card to begin.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`card relative flex flex-col p-7 ${
                  t.highlight ? "border-violet-glow/40 shadow-glow" : ""
                }`}
              >
                {t.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-glow to-violet-deep px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-white">{t.name}</h3>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="display text-4xl font-semibold text-white">{t.price}</span>
                  <span className="pb-1 text-sm text-mist-dim">/ {t.cadence}</span>
                </div>
                <p className="mt-2 text-sm text-mist">{t.blurb}</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-white/90">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-glow" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/dashboard"
                  className={`mt-7 ${t.highlight ? "btn-primary" : "btn-ghost"} w-full`}
                >
                  {t.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-sm text-mist-dim">
            All plans include Vera. Usage-based model costs billed at cost. Cancel anytime.
          </p>
        </section>
        <SiteFooter />
      </div>
    </div>
  );
}
