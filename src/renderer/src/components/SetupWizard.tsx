import type { DesignSystem, Settings } from "@shared/types";
import { providerPreset } from "@shared/providers";
import { ImportForm } from "../pages/DesignSystemsPage";
import { Icon } from "../ui/icons";
import ProviderSettings from "./ProviderSettings";

// The first item is already done when the wizard opens, so the user starts with progress.
const STEPS = ["Atelier installed", "Design system", "AI model", "Build"];

/** First-run setup: import a design system, pick a model, then start building. Stays until the user continues. */
export default function SetupWizard({
  systems,
  settings,
  onSettings,
  onImported,
  onSkip,
  onFinish,
}: {
  systems: DesignSystem[];
  settings: Settings;
  onSettings(s: Settings): void;
  onImported(): void;
  onSkip(): void;
  onFinish(): void;
}) {
  const ds = systems[0];
  const step = !ds ? 1 : settings.ready ? 3 : 2;
  const components = ds?.components.filter((c) => c.enabled).length ?? 0;
  return (
    <div className="wizard card">
      <ol className="wiz-steps" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "current" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="wiz-dot">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 1 && (
        <>
          <h2>Start with your design system</h2>
          <p className="muted">Import your own, or pick a library to try. The AI will build screens only from its components.</p>
          <ImportForm embedded onImported={onImported} />
        </>
      )}
      {step === 2 && (
        <>
          <h2>Choose an AI model</h2>
          <p className="muted">
            {ds.name} is imported with {components} components. Add a key, or pick a local provider.
          </p>
          <ProviderSettings compact settings={settings} onSettings={onSettings} />
        </>
      )}
      {step === 3 && (
        <div className="wiz-done">
          <h2>You're set</h2>
          <ul>
            <li>
              <Icon name="check" size={14} /> {ds.name}: {components} components
            </li>
            {ds.invariant?.components ? (
              <li>
                <Icon name="check" size={14} /> Invariant UI compliance contract built from {ds.invariant.components} components
              </li>
            ) : null}
            <li>
              <Icon name="check" size={14} /> {providerPreset(settings.provider).label} · {settings.model}
            </li>
          </ul>
          <button className="primary" onClick={onFinish}>
            Build your first screen
          </button>
        </div>
      )}
      {step < 3 && (
        <button className="wiz-skip" onClick={onSkip}>
          Skip for now
        </button>
      )}
    </div>
  );
}
