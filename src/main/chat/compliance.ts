import fs from "node:fs";
import path from "node:path";
import type { ComplianceIssue, DesignSystem } from "@shared/types";
import { FOREIGN_UI_PACKAGES, nativeReplacements } from "../design-system/rules";

const IMPORT = /^\s*import\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/gm;

/**
 * Checks generated files against the design system: competing UI libraries,
 * raw elements that have a design system equivalent, and imports of names the
 * design system does not export (the usual sign of a hallucinated component).
 */
export function checkCompliance(
  appDir: string,
  files: string[],
  ds: DesignSystem,
  sourceExtensions: string[],
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const dsPaths = new Set(ds.components.map((c) => c.importPath));
  dsPaths.add(ds.packageName);
  const exported = new Set(ds.components.map((c) => c.name.split(".")[0]));
  const natives = nativeReplacements(ds.components.filter((c) => c.enabled));
  const isOwnPackage = (spec: string) => spec === ds.packageName || spec.startsWith(`${ds.packageName}/`);

  for (const rel of files) {
    if (!sourceExtensions.includes(path.extname(rel))) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(appDir, rel), "utf8");
    } catch {
      continue;
    }
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;

    for (const m of text.matchAll(IMPORT)) {
      const [, typeOnly, clause, spec] = m;
      const line = lineOf(m.index ?? 0);
      if (!isOwnPackage(spec) && FOREIGN_UI_PACKAGES.some((p) => spec === p.replace(/\/$/, "") || spec.startsWith(p))) {
        issues.push({ file: rel, line, rule: "foreign-ui-library", message: `Imports ${spec}, which is not part of ${ds.name}.` });
      }
      if (typeOnly || !clause || !dsPaths.has(spec) || exported.size === 0) continue;
      const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
      for (const part of named.split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (!name || part.trim().startsWith("type ") || !/^[A-Z]/.test(name)) continue;
        if (/(Props|Type|Variant|Size|Theme)$/.test(name)) continue;
        if (!exported.has(name)) {
          issues.push({
            file: rel,
            line,
            rule: "unknown-ds-export",
            message: `${name} is not a component in the ${ds.name} catalog.`,
          });
        }
      }
    }

    for (const [el, component] of natives) {
      const re = new RegExp(`<${el}(?=[\\s>/])`, "g");
      for (const m of text.matchAll(re)) {
        issues.push({
          file: rel,
          line: lineOf(m.index ?? 0),
          rule: "native-element",
          message: `Raw <${el}> used; ${ds.name} provides ${component}.`,
        });
      }
    }
  }
  return issues;
}

export function complianceFixPrompt(issues: ComplianceIssue[], ds: DesignSystem): string {
  const list = issues.map((i) => `- ${i.file}:${i.line} ${i.message}`).join("\n");
  return `Fix these design system issues so the app only uses ${ds.name}:\n${list}`;
}
