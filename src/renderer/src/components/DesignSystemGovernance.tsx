import { useEffect, useState } from "react";
import type { DesignSystem } from "@shared/types";
import { api, errorMessage } from "../api";
import { relativeTime } from "../format";
import { Alert, Disclosure, TextArea, toast } from "../ui/slab";

type Busy = "compile" | "save" | "install" | null;

/**
 * Everything that governs what the AI builds with a design system: the Invariant UI contract compiled when it
 * was imported, the team's own guidelines, and the exact rules the model receives.
 */
export default function DesignSystemGovernance({ ds, onChange }: { ds: DesignSystem; onChange(ds: DesignSystem): void }) {
  const [guidelines, setGuidelines] = useState(ds.guidelines);
  const [rules, setRules] = useState("");
  const [browserReady, setBrowserReady] = useState<boolean>();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.invoke("ds:preview-rules", ds.id).then(setRules);
  }, [ds]);
  useEffect(() => {
    const load = () => void api.invoke("invariant:browser-ready").then(setBrowserReady);
    load();
    // Browser checks install in the background after an import.
    return api.on("invariant:updated", load);
  }, []);

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

  const contract = ds.invariant;
  return (
    <div className="governance-stack">
      {error && (
        <Alert tone="danger" onDismiss={() => setError(undefined)}>
          {error}
        </Alert>
      )}

      <section className="card">
        <div className="row">
          <strong className="grow">Contract</strong>
          <span className={`meta-pill${contract?.components ? " ok" : ""}`}>
            {contract ? `${contract.components} component${contract.components === 1 ? "" : "s"}` : "Not compiled"}
          </span>
          <button
            className="sm"
            disabled={busy !== null}
            onClick={() =>
              run("compile", async () => {
                onChange(await api.invoke("invariant:compile-ds", ds.id));
                toast("Contract compiled.", "success");
              })
            }
          >
            {busy === "compile" ? "Compiling…" : contract ? "Recompile" : "Compile"}
          </button>
        </div>
        <p className="muted small">
          <a href="https://invariantui.com" target="_blank" rel="noreferrer">
            Invariant UI
          </a>{" "}
          turns this design system into a contract of components, props and approved patterns. The AI reads it while it builds, and each turn's code is
          checked against it. Atelier compiles it when you import or re-import, and apps pick it up automatically.
          {contract && ` Last compiled ${relativeTime(contract.compiledAt)}.`}
        </p>
        {contract?.error && <Alert tone="warning">{contract.error}</Alert>}
        {contract && !contract.error && contract.components === 0 && (
          <Alert tone="warning">Invariant found no components in this package's declaration files, so there is nothing to check code against.</Alert>
        )}
      </section>

      <section className="card">
        <div className="row">
          <strong className="grow">Browser checks</strong>
          <span className={`meta-pill${browserReady ? " ok" : ""}`}>{browserReady === undefined ? "Checking…" : browserReady ? "Ready" : "Not installed"}</span>
          {browserReady === false && (
            <button
              className="sm"
              disabled={busy !== null}
              onClick={() =>
                run("install", async () => {
                  await api.invoke("invariant:install-browser");
                  setBrowserReady(await api.invoke("invariant:browser-ready"));
                })
              }
            >
              {busy === "install" ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <p className="muted small">
          Focus, keyboard order and responsive checks run in a real browser against an app's running preview, from the app's Checks tab. Atelier installs
          Playwright and Chromium once (about 150 MB) and shares them with every app.
        </p>
      </section>

      <section className="card form">
        <strong>Guidelines</strong>
        <p className="muted">
          Usage rules from your design system team, sent verbatim with every request. Write them as you would for a new engineer: when to use which
          component, layout conventions, content rules, accessibility requirements.
        </p>
        <TextArea label="Guidelines" hideLabel rows={16} value={guidelines} onValue={setGuidelines} />
        <div>
          <button
            className="primary"
            disabled={busy !== null || guidelines === ds.guidelines}
            onClick={() =>
              run("save", async () => {
                onChange(await api.invoke("ds:update", ds.id, { guidelines }));
                toast("Saved.", "success");
              })
            }
          >
            Save guidelines
          </button>
        </div>
      </section>

      <section className="card">
        <Disclosure label="AI rules preview">
          <p className="muted">
            Exactly what the model receives about this design system ({Math.round(rules.length / 4).toLocaleString()} tokens, roughly). It is cached
            between turns.
          </p>
          <pre className="code">{rules}</pre>
        </Disclosure>
      </section>
    </div>
  );
}
