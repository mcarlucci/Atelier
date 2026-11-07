import type { DesignSystem, Settings } from "@shared/types";
import { ImportForm } from "../pages/DesignSystemsPage";
import { Icon } from "../ui/icons";
import ProviderSettings from "./ProviderSettings";

const STEPS = ["Design system", "AI model", "Build"];

/** First-run setup: import a design system, then pick a model. Shown until both are done. */
export default function SetupWizard({
  systems,
  settings,
  onSettings,
  onImported,
  onSkip,
}: {
  systems: DesignSystem[];
  settings: Settings;
  onSettings(s: Settings): void;
  onImported(): void;
  onSkip(): void;
}) {
  const step = systems.length === 0 ? 0 : 1;
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
      {step === 0 ? (
        <>
          <h2>Start with your design system</h2>
          <p className="muted">Import your own, or pick a library to try. The AI will build screens only from its components.</p>
          <ImportForm embedded onImported={onImported} />
        </>
      ) : (
        <>
          <h2>Choose an AI model</h2>
          <p className="muted">
            {systems[0].name} is ready. Add a key, or pick a local provider, and you can describe your first screen.
          </p>
          <ProviderSettings settings={settings} onSettings={onSettings} />
        </>
      )}
      <button className="wiz-skip" onClick={onSkip}>
        Skip for now
      </button>
    </div>
  );
}
