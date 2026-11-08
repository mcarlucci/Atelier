import { useCallback, useEffect, useState } from "react";
import type { InvariantBrowserReport, InvariantStatus, InvariantValidateResult } from "@shared/invariant";
import type { DesignSystem } from "@shared/types";
import { api, errorMessage } from "../api";
import { Alert } from "../ui/slab";

type Busy = "validate" | "browser" | null;

/**
 * Invariant UI checks for one app: code checks against the design system's contract, and browser checks against
 * the running preview. The contract itself lives on the design system's Compliance tab.
 */
export default function ChecksPanel({
  appId,
  ds,
  refreshKey,
  onOpenCompliance,
  autoResult,
  onFix,
}: {
  appId: string;
  ds?: DesignSystem;
  refreshKey: number;
  onOpenCompliance(): void;
  /** The code check that ran by itself after the last build. */
  autoResult?: InvariantValidateResult;
  /** Sends the violations to the AI to fix. */
  onFix?(prompt: string): void;
}) {
  const [status, setStatus] = useState<InvariantStatus>();
  const [manual, setResult] = useState<InvariantValidateResult>();
  const [browser, setBrowser] = useState<InvariantBrowserReport>();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setStatus(await api.invoke("invariant:status", appId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [appId]);
  useEffect(() => api.on("invariant:updated", () => void load()), [load]);
  useEffect(() => {
    setResult(undefined);
    setBrowser(undefined);
    void load();
  }, [load, refreshKey]);

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const complianceLink = (label: string) => (
    <button className="link" onClick={onOpenCompliance}>
      {label}
    </button>
  );
  const result = manual ?? autoResult;
  // "Could not verify" findings are information, not violations to fix.
  const issues = result?.violations.filter((v) => v.severity !== "info") ?? [];
  const unverified = (result?.violations.length ?? 0) - issues.length;
  const pr = result?.summary.patternRules;
  return (
    <div className="page-scroll compliance">
      <div>
        <h2>Checks</h2>
        <p className="muted small">
          Checks this app against {ds ? `${ds.name}'s` : "its design system's"} contract with{" "}
          <a href="https://invariantui.com" target="_blank" rel="noreferrer">
            Invariant UI
          </a>
          {status?.version ? ` ${status.version}` : ""}. Results that can't be verified are never counted as passes.{" "}
          {complianceLink("Open compliance")}
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {status && !status.installed && <Alert tone="warning">Invariant UI isn't bundled with this build.</Alert>}
      {status && status.installed && !status.compiled && (
        <Alert tone="warning">
          This app has no contract to check against yet. {status.message ?? "Compile the design system's contract from its Compliance tab."}{" "}
          {complianceLink("Open compliance")}
        </Alert>
      )}

      <section>
        <div className="row">
          <strong className="grow">Code checks</strong>
          {status?.compiled && ds?.invariant && <span className="meta-pill ok">{ds.invariant.components} components in contract</span>}
          <button className="sm" disabled={!status?.compiled || busy !== null} onClick={() => run("validate", async () => setResult(await api.invoke("invariant:validate", appId)))}>
            {busy === "validate" ? "Checking…" : "Validate"}
          </button>
        </div>
        {result && (
          <>
            <p className="small">
              {result.summary.files} files · {result.summary.errors} errors · {result.summary.warnings} warnings
              {pr && ` · pattern rules: ${pr.pass} pass, ${pr.fail} fail, ${pr.warning} warning, ${pr.notVerifiable} not verifiable, ${pr.skipped} skipped`}
            </p>
            <ul className="compliance-list">
              {issues.map((v, i) => (
                <li key={i}>
                  <span className={`meta-pill${v.severity === "error" ? " bad" : ""}`}>{v.severity}</span>{" "}
                  <code>
                    {v.file}:{v.line ?? 1}
                  </code>{" "}
                  {v.message}
                  {v.suggestion && <div className="muted small">Fix: {v.suggestion}</div>}
                </li>
              ))}
              {issues.length === 0 && <li className="muted">No violations.</li>}
            </ul>
            {unverified > 0 && <p className="muted small">{unverified} {unverified === 1 ? "prop" : "props"} could not be verified because the library's prop list is incomplete.</p>}
            {onFix && issues.length > 0 && (
              <button
                className="sm primary"
                onClick={() =>
                  onFix(`Fix these compliance violations:\n${issues.map((v) => `- ${v.file}:${v.line ?? 1} ${v.message}${v.suggestion ? ` (${v.suggestion})` : ""}`).join("\n")}`)
                }
              >
                Fix with AI
              </button>
            )}
          </>
        )}
      </section>

      <section>
        <div className="row">
          <strong className="grow">Browser checks</strong>
          <button className="sm" disabled={!status?.compiled || !status?.browserReady || busy !== null} onClick={() => run("browser", async () => setBrowser(await api.invoke("invariant:browser-run", appId)))}>
            {busy === "browser" ? "Running…" : "Run"}
          </button>
        </div>
        {status && !status.browserReady ? (
          <p className="muted small">Browser checks aren't installed yet. {complianceLink("Install them from compliance")}</p>
        ) : (
          <p className="muted small">The app must be running.</p>
        )}
        {browser && (
          <>
            <p className="small">
              {browser.browser.name} {browser.browser.version}: {browser.summary.pass} passed, {browser.summary.fail} failed, {browser.summary.error} could not run
            </p>
            <ul className="compliance-list">
              {browser.results
                .filter((r) => r.status !== "pass")
                .map((r, i) => (
                  <li key={i}>
                    <span className="meta-pill bad">{r.status}</span> {r.scenario} · {r.check}
                    {r.reason && <div className="muted small">{r.reason}</div>}
                    {r.suggestion && <div className="muted small">Fix: {r.suggestion}</div>}
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
