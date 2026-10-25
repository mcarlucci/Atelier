import type { ComponentInfo, DesignSystem, FrameworkId } from "@shared/types";

/**
 * What every template of one framework shares: how components are referenced,
 * which files the compliance check scans, and the generated design system
 * setup files. Templates (src/main/templates) add the app around it.
 */
export interface FrameworkKit {
  id: FrameworkId;
  label: string;
  /** Source extensions scanned by the compliance check. */
  sourceExtensions: string[];
  /** Where a template puts the main setup file unless it says otherwise. */
  defaultSetupPath: string;
  /** How the model should reference one component (tag, import line). */
  usage(component: ComponentInfo): string;
  /** Generated setup files keyed by path; the main one is at `mainPath`. The model may not edit them. */
  setupFiles(ds: DesignSystem, mainPath: string): Record<string, string>;
  /** Rules about the setup files, for every template of this framework. */
  setupRules(ds: DesignSystem, mainPath: string): string;
  /** Environment for the dev server and installs. */
  env?: Record<string, string>;
}
