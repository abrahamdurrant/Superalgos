import type { Company, Kpi, Project, Task } from "./types";

export const SEED_COMPANY: Company = {
  name: "Lumen Labs",
  idea: "An AI study companion that turns any PDF or lecture into quizzes, flashcards, and a tutor that answers questions.",
  stage: "Pre-launch",
};

export const SEED_HIRES = ["dex", "jordan", "casey"];

export const SEED_KPIS: Kpi[] = [
  { id: "k1", label: "Monthly recurring revenue", value: "$4.2k", delta: "+18%", trend: "up" },
  { id: "k2", label: "Waitlist signups", value: "2,910", delta: "+340", trend: "up" },
  { id: "k3", label: "Runway", value: "14 mo", delta: "stable", trend: "flat" },
  { id: "k4", label: "Activation rate", value: "61%", delta: "+4pts", trend: "up" },
];

export const SEED_PROJECTS: Project[] = [
  { id: "p1", name: "Public launch", goal: "Ship v1 and convert the waitlist.", createdAt: Date.now() - 86400000 * 6 },
  { id: "p2", name: "Content engine", goal: "Rank for 'AI study tools' and drive organic signups.", createdAt: Date.now() - 86400000 * 4 },
];

export const SEED_TASKS: Task[] = [
  { id: "t1", title: "Ship quiz-generation v1", detail: "PDF → 10 question quiz, graded with explanations.", status: "in_progress", ownerId: "dex", projectId: "p1", createdAt: Date.now() - 86400000 * 5 },
  { id: "t2", title: "Wire up Stripe + paywall", detail: "Free tier: 3 docs. Pro: unlimited.", status: "in_progress", ownerId: "dex", projectId: "p1", createdAt: Date.now() - 86400000 * 3 },
  { id: "t3", title: "Launch-week email sequence", detail: "5 emails to the 2,910-person waitlist.", status: "review", ownerId: "jordan", projectId: "p1", createdAt: Date.now() - 86400000 * 2 },
  { id: "t4", title: "Product Hunt assets", detail: "Gallery, tagline, first comment, hunter outreach.", status: "backlog", ownerId: "jordan", projectId: "p1", createdAt: Date.now() - 86400000 * 2 },
  { id: "t5", title: "Pillar post: 'How to study with AI'", detail: "2,500 words, targets a 12k/mo keyword.", status: "in_progress", ownerId: "casey", projectId: "p2", createdAt: Date.now() - 86400000 * 3 },
  { id: "t6", title: "10 comparison landing pages", detail: "Lumen vs. each major competitor.", status: "backlog", ownerId: "casey", projectId: "p2", createdAt: Date.now() - 86400000 },
  { id: "t7", title: "Onboarding flow polish", detail: "Cut first-quiz time to under 60 seconds.", status: "done", ownerId: "dex", projectId: "p1", createdAt: Date.now() - 86400000 * 6 },
];

export const SEED_ACTIVITY: { id: string; ownerId: string; text: string; at: number }[] = [
  { id: "a1", ownerId: "dex", text: "Opened PR #142 — quiz grading with explanations.", at: Date.now() - 3600000 * 2 },
  { id: "a2", ownerId: "jordan", text: "Drafted the launch-week email sequence for review.", at: Date.now() - 3600000 * 5 },
  { id: "a3", ownerId: "vera", text: "Reprioritized the launch board — paywall now blocks v1.", at: Date.now() - 3600000 * 7 },
  { id: "a4", ownerId: "casey", text: "Published pillar draft; sent to Sage for SEO pass.", at: Date.now() - 3600000 * 26 },
];
