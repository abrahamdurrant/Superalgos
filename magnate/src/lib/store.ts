"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AgentAction,
  ChatMessage,
  Company,
  Kpi,
  Project,
  Task,
  TaskStatus,
} from "./types";
import { VERA_ID } from "./employees";
import {
  SEED_ACTIVITY,
  SEED_COMPANY,
  SEED_HIRES,
  SEED_KPIS,
  SEED_PROJECTS,
  SEED_TASKS,
} from "./seed";

export interface Activity {
  id: string;
  ownerId: string;
  text: string;
  at: number;
}

interface MagnateState {
  company: Company;
  hires: string[];
  kpis: Kpi[];
  projects: Project[];
  tasks: Task[];
  activity: Activity[];
  messages: ChatMessage[];

  setCompany: (c: Partial<Company>) => void;
  hire: (id: string) => void;
  fire: (id: string) => void;
  addProject: (name: string, goal: string) => Project;
  addTask: (t: Omit<Task, "id" | "createdAt">) => Task;
  moveTask: (id: string, status: TaskStatus) => void;
  logActivity: (ownerId: string, text: string) => void;

  addMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  resetChat: () => void;

  applyAction: (action: AgentAction) => string;
  resetAll: () => void;
}

const rid = () => Math.random().toString(36).slice(2, 10);

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  authorId: VERA_ID,
  content:
    "I'm Vera, your CEO. I've got the launch and content engines moving. Tell me a goal — \"get us to 100 paying users\", \"prep the Product Hunt launch\", \"figure out pricing\" — and I'll break it down, put the team on it, and report back. What should we tackle?",
  createdAt: Date.now(),
};

export const useStore = create<MagnateState>()(
  persist(
    (set, get) => ({
      company: SEED_COMPANY,
      hires: SEED_HIRES,
      kpis: SEED_KPIS,
      projects: SEED_PROJECTS,
      tasks: SEED_TASKS,
      activity: SEED_ACTIVITY,
      messages: [WELCOME],

      setCompany: (c) => set((s) => ({ company: { ...s.company, ...c } })),

      hire: (id) =>
        set((s) =>
          s.hires.includes(id) ? s : { hires: [...s.hires, id] },
        ),

      fire: (id) => set((s) => ({ hires: s.hires.filter((h) => h !== id) })),

      addProject: (name, goal) => {
        const project: Project = { id: rid(), name, goal, createdAt: Date.now() };
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },

      addTask: (t) => {
        const task: Task = { ...t, id: rid(), createdAt: Date.now() };
        set((s) => ({ tasks: [...s.tasks, task] }));
        return task;
      },

      moveTask: (id, status) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)),
        })),

      logActivity: (ownerId, text) =>
        set((s) => ({
          activity: [{ id: rid(), ownerId, text, at: Date.now() }, ...s.activity].slice(0, 40),
        })),

      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

      updateMessage: (id, patch) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),

      resetChat: () => set({ messages: [WELCOME] }),

      /** Apply a structured action from the AI CEO; returns a human label. */
      applyAction: (action) => {
        const s = get();
        switch (action.type) {
          case "create_project": {
            const exists = s.projects.find(
              (p) => p.name.toLowerCase() === action.name.toLowerCase(),
            );
            if (!exists) get().addProject(action.name, action.goal);
            get().logActivity(VERA_ID, `Created project "${action.name}".`);
            return `Created project "${action.name}"`;
          }
          case "assign_task": {
            let project = s.projects.find(
              (p) =>
                action.projectName &&
                p.name.toLowerCase() === action.projectName.toLowerCase(),
            );
            if (!project) {
              project =
                get().projects[0] ??
                get().addProject(action.projectName ?? "New initiative", "");
            }
            get().addTask({
              title: action.title,
              detail: action.detail,
              status: action.status ?? "backlog",
              ownerId: action.ownerId,
              projectId: project.id,
            });
            get().logActivity(VERA_ID, `Assigned "${action.title}".`);
            return `Assigned "${action.title}"`;
          }
          case "hire": {
            get().hire(action.employeeId);
            get().logActivity(VERA_ID, `Brought a new employee onto the team.`);
            return `Hired a new employee`;
          }
          case "set_kpi": {
            set((st) => {
              const existing = st.kpis.find(
                (k) => k.label.toLowerCase() === action.label.toLowerCase(),
              );
              if (existing) {
                return {
                  kpis: st.kpis.map((k) =>
                    k.id === existing.id
                      ? { ...k, value: action.value, delta: action.delta }
                      : k,
                  ),
                };
              }
              return {
                kpis: [
                  ...st.kpis,
                  { id: rid(), label: action.label, value: action.value, delta: action.delta, trend: "up" },
                ],
              };
            });
            return `Updated KPI "${action.label}"`;
          }
        }
      },

      resetAll: () =>
        set({
          company: SEED_COMPANY,
          hires: SEED_HIRES,
          kpis: SEED_KPIS,
          projects: SEED_PROJECTS,
          tasks: SEED_TASKS,
          activity: SEED_ACTIVITY,
          messages: [WELCOME],
        }),
    }),
    { name: "magnate-store-v1" },
  ),
);
