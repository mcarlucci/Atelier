/** Template records: built-in templates plus custom ones imported by the team. */
import fs from "node:fs";
import path from "node:path";
import type { AppRecord, DesignSystem, FrameworkId } from "@shared/types";
import { BUILTIN_TEMPLATE_IDS, defaultTemplateFor, isCompatible, type TemplateInfo, type TemplateSource, type TemplateUpdate } from "@shared/templates";
import { newId, type Store } from "../store";
import { checkWiring, detectTemplate, frameworkMajorOf, snapshotSource, wireAngularTemplate } from "./custom";
import { builtinTemplateInfos, runtimeFor, type TemplateRuntime } from "./index";

const FRAMEWORKS: FrameworkId[] = ["react", "vue", "angular"];

export class TemplateService {
  constructor(
    private readonly store: Store,
    private readonly dir: string,
  ) {
    this.wireExistingAngularTemplates();
  }

  /** Angular templates imported before Atelier wired them in are wired once, so their warnings clear. */
  private wireExistingAngularTemplates(): void {
    for (const t of this.store.get().templates ?? []) {
      const files = this.filesDir(t.id);
      if (t.framework !== "angular" || !t.warnings.length || !fs.existsSync(files)) continue;
      try {
        if (wireAngularTemplate(files, t.setupFile).length) this.replace({ ...t, warnings: checkWiring(files, t) });
      } catch {
        // A snapshot that can't be read keeps its warnings.
      }
    }
  }

  list(): TemplateInfo[] {
    const custom = (this.store.get().templates ?? []).map((t) => (t.frameworkMajor === undefined ? { ...t, frameworkMajor: frameworkMajorOf(this.filesDir(t.id), t.framework) } : t));
    return [...builtinTemplateInfos(), ...custom];
  }

  get(id: string): TemplateInfo {
    const t = this.list().find((x) => x.id === id);
    if (!t) throw new Error("That template no longer exists.");
    return t;
  }

  runtime(id: string): TemplateRuntime {
    const info = this.get(id);
    return runtimeFor(info, info.source.kind === "builtin" ? undefined : this.filesDir(id));
  }

  /** Apps made before templates existed use their framework's built-in template. */
  forApp(app: AppRecord): TemplateRuntime {
    return this.runtime(app.templateId ?? BUILTIN_TEMPLATE_IDS[app.framework]);
  }

  /** The template to use for a new app: the one asked for (if it fits), else the design system's default. */
  choose(ds: DesignSystem, templateId?: string): TemplateInfo {
    if (templateId) {
      const t = this.get(templateId);
      if (!isCompatible(t, ds)) throw new Error(`“${t.name}” is a ${t.framework} template, but ${ds.name} is a ${ds.framework} design system.`);
      return t;
    }
    const t = defaultTemplateFor(ds, this.list());
    if (!t) throw new Error(`No template can load ${ds.name}.`);
    return t;
  }

  async import(source: Exclude<TemplateSource, { kind: "builtin" }>): Promise<TemplateInfo> {
    const id = newId();
    const files = this.filesDir(id);
    try {
      await snapshotSource(source, files);
      const d = detectTemplate(files);
      if (d.framework === "angular" && wireAngularTemplate(files, d.setupFile).length) d.warnings = checkWiring(files, d);
      const info: TemplateInfo = {
        id,
        name: d.name,
        framework: d.framework,
        stack: d.stack,
        description: d.description,
        source,
        devCommand: d.devCommand,
        setupFile: d.setupFile,
        rules: d.rules,
        importedAt: Date.now(),
        frameworkMajor: frameworkMajorOf(files, d.framework),
        warnings: d.warnings,
      };
      this.store.update((s) => (s.templates ??= []).push(info));
      return info;
    } catch (err) {
      fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
      throw err;
    }
  }

  update(id: string, patch: TemplateUpdate): TemplateInfo {
    const current = this.custom(id);
    const next: TemplateInfo = { ...current };
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Give the template a name.");
      next.name = patch.name.trim().slice(0, 80);
    }
    if (patch.description !== undefined) next.description = patch.description.slice(0, 500);
    if (patch.rules !== undefined) next.rules = patch.rules.slice(0, 20_000);
    if (patch.framework !== undefined) {
      if (!FRAMEWORKS.includes(patch.framework)) throw new Error("Unknown framework.");
      if (patch.framework !== current.framework && this.usedBy(id).length) throw new Error("Apps already use this template, so its framework can't change.");
      next.framework = patch.framework;
    }
    if (patch.devCommand !== undefined) {
      if (!patch.devCommand.trim()) throw new Error("Enter the command that starts the dev server.");
      next.devCommand = patch.devCommand.trim();
    }
    if (patch.setupFile !== undefined) next.setupFile = safeRelative(patch.setupFile);
    next.warnings = checkWiring(this.filesDir(id), next);
    this.replace(next);
    return next;
  }

  /** Takes a fresh snapshot from the folder or repository; edited settings are kept. */
  async refresh(id: string): Promise<TemplateInfo> {
    const current = this.custom(id);
    if (current.source.kind === "builtin") throw new Error("Built-in templates can't be refreshed.");
    const files = this.filesDir(id);
    await snapshotSource(current.source, files);
    if (current.framework === "angular") wireAngularTemplate(files, current.setupFile);
    const next = { ...current, importedAt: Date.now(), frameworkMajor: frameworkMajorOf(files, current.framework), warnings: checkWiring(files, current) };
    this.replace(next);
    return next;
  }

  remove(id: string): void {
    this.custom(id);
    if (this.usedBy(id).length) throw new Error("Delete the apps made from this template first.");
    this.store.update((s) => {
      s.templates = (s.templates ?? []).filter((t) => t.id !== id);
      for (const ds of s.designSystems) if (ds.defaultTemplateId === id) delete ds.defaultTemplateId;
    });
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }

  /** Files of a custom template, for the details view. */
  files(id: string): string[] {
    this.custom(id);
    const root = this.filesDir(id);
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(r);
        else if (out.length < 500) out.push(r);
      }
    };
    if (fs.existsSync(root)) walk("");
    return out.sort();
  }

  private usedBy(id: string): AppRecord[] {
    return this.store.get().apps.filter((a) => a.templateId === id);
  }

  private custom(id: string): TemplateInfo {
    const t = this.store.get().templates?.find((x) => x.id === id);
    if (!t) throw new Error(builtinTemplateInfos().some((b) => b.id === id) ? "Built-in templates can't be changed." : "Template not found.");
    return t;
  }

  private replace(t: TemplateInfo): void {
    this.store.update((s) => {
      s.templates = (s.templates ?? []).map((x) => (x.id === t.id ? t : x));
    });
  }

  private filesDir(id: string): string {
    return path.join(this.dir, id, "files");
  }
}

/** A setup file path inside the app, such as src/design-system/DesignSystemRoot.tsx. */
function safeRelative(p: string): string {
  const rel = p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || rel.split("/").includes("..") || /^[A-Za-z]:/.test(rel)) {
    throw new Error("The setup file must be a path inside the app, such as src/design-system/DesignSystemRoot.tsx.");
  }
  return rel;
}
