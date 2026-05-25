import type { Company, Kpi, Project, Task } from "./types";

export const SEED_COMPANY: Company = {
  name: "Avaratak",
  idea: "",
  stage: "Getting started",
};

/** Start with just Vera (the CEO). Hire the rest from the AI Team page. */
export const SEED_HIRES: string[] = [];

export const SEED_KPIS: Kpi[] = [];

export const SEED_PROJECTS: Project[] = [];

export const SEED_TASKS: Task[] = [];

export const SEED_ACTIVITY: { id: string; ownerId: string; text: string; at: number }[] = [];
