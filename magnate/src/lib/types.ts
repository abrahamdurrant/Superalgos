export type Department =
  | "Executive"
  | "Engineering"
  | "Growth"
  | "Finance"
  | "Research"
  | "Content"
  | "Legal"
  | "Operations";

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: Department;
  tagline: string;
  blurb: string;
  skills: string[];
  /** Two-letter monogram for the avatar. */
  monogram: string;
  /** Tailwind gradient stops for the avatar. */
  accent: [string, string];
  /** System persona used when this employee speaks. */
  persona: string;
  priceNote: string;
}

export type TaskStatus = "backlog" | "in_progress" | "review" | "done";

export interface Task {
  id: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  ownerId: string;
  projectId: string;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  goal: string;
  createdAt: number;
}

export interface Kpi {
  id: string;
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Which employee authored an assistant message. */
  authorId: string;
  content: string;
  createdAt: number;
  /** Names of actions Vera took while producing this message. */
  actions?: string[];
  pending?: boolean;
}

export interface Company {
  name: string;
  idea: string;
  stage: string;
}

/** Structured actions the AI CEO can take, surfaced to the client. */
export type AgentAction =
  | { type: "create_project"; name: string; goal: string }
  | {
      type: "assign_task";
      title: string;
      detail?: string;
      ownerId: string;
      projectName?: string;
      status?: TaskStatus;
    }
  | { type: "hire"; employeeId: string }
  | { type: "set_kpi"; label: string; value: string; delta?: string }
  | { type: "blog_post"; title: string; url?: string; status: "draft" | "published" };
