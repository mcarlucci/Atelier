/**
 * Types for Invariant UI (https://invariantui.com), which compiles a design
 * system into a contract and validates app code against it. Shapes mirror the
 * CLI's `--json` output (invariant-ui 0.1.x): `validate`, `browser run`.
 */

export type InvariantSeverity = "error" | "warning" | "info";
export type InvariantBasis = "discovered" | "documented" | "inferred" | "approved" | "heuristic";
export type InvariantEvaluationStatus = "pass" | "fail" | "warning" | "not-verifiable" | "skipped";

export interface InvariantViolation {
  code: string;
  severity: InvariantSeverity;
  message: string;
  file: string;
  line?: number;
  column?: number;
  subject?: string;
  basis: InvariantBasis;
  suggestion?: string;
}

export interface InvariantEvaluation {
  rule: string;
  status: InvariantEvaluationStatus;
  reason: string;
  pattern: string;
  constraint: string;
  file?: string;
  line?: number;
}

export interface InvariantSummary {
  files: number;
  errors: number;
  warnings: number;
  info: number;
  componentsChecked: number;
  patternRules: { pass: number; fail: number; warning: number; notVerifiable: number; skipped: number };
}

export interface InvariantValidateResult {
  contractHash: string;
  summary: InvariantSummary;
  violations: InvariantViolation[];
  evaluations: InvariantEvaluation[];
}

export type InvariantBrowserStatus = "pass" | "fail" | "error";

export interface InvariantBrowserResult {
  scenario: string;
  check: string;
  status: InvariantBrowserStatus;
  reason?: string;
  suggestion?: string;
  context: { viewport: { width: number; height: number } };
}

export interface InvariantBrowserReport {
  version: number;
  kind: "runtime";
  browser: { name: string; version: string };
  summary: { pass: number; fail: number; error: number };
  notes: string[];
  results: InvariantBrowserResult[];
}

/** What the renderer shows for an app or design system. */
export interface InvariantStatus {
  /** invariant-ui is installed in Atelier's managed directory. */
  installed: boolean;
  version?: string;
  /** A contract has been compiled for this design system. */
  compiled: boolean;
  /** `verify --fresh` found the contract stale or hand-edited. */
  stale?: boolean;
  /** Playwright is available for browser checks. */
  browserReady: boolean;
  message?: string;
}
