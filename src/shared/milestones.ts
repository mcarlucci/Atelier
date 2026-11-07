import type { Progress } from "./types";

export interface Milestone {
  id: string;
  label: string;
  done: boolean;
}

/** The home page checklist. The design system and first app count from what already exists, so existing users start with progress; the rest from stored dates. */
export function milestones(input: { designSystems: number; apps: number; progress?: Progress }): Milestone[] {
  const p = input.progress ?? {};
  return [
    { id: "design-system", label: "Import a design system", done: input.designSystems > 0 },
    { id: "first-build", label: "Build your first screen", done: p.firstBuild !== undefined || input.apps > 0 },
    { id: "compliance", label: "Pass a compliance check", done: p.compliancePass !== undefined },
    { id: "restore", label: "Undo or restore a version", done: p.restored !== undefined },
  ];
}
