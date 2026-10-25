import type { ComponentInfo, DesignSystem, PropInfo } from "@shared/types";
import { BUILTIN_TEMPLATE_IDS } from "@shared/templates";
import { builtinTemplateInfos, runtimeFor, type TemplateRuntime } from "../templates";

/** Packages that compete with an imported design system. */
export const FOREIGN_UI_PACKAGES = [
  "@mui/",
  "@material-ui/",
  "antd",
  "@chakra-ui/",
  "@mantine/",
  "bootstrap",
  "react-bootstrap",
  "tailwindcss",
  "@headlessui/",
  "@radix-ui/",
  "shadcn",
  "@shadcn/",
  "semantic-ui-react",
  "primereact",
  "primevue",
  "primeng",
  "vuetify",
  "element-plus",
  "@angular/material",
  "styled-components",
  "@emotion/",
];

const COMMON_PROP_SHARE = 0.25;
const COMMON_PROP_MIN_COMPONENTS = 5;

/**
 * The design-system half of the system prompt. The rules are generated from
 * the imported catalog so the model only reaches for the customer's components.
 */
export function buildDesignSystemRules(ds: DesignSystem, template?: TemplateRuntime): string {
  const runtime = template ?? runtimeFor(builtinTemplateInfos().find((t) => t.id === BUILTIN_TEMPLATE_IDS[ds.framework])!);
  const enabled = ds.components.filter((c) => c.enabled);
  const common = commonProps(enabled);
  const commonNames = new Set(common.map((p) => p.name));
  const natives = nativeReplacements(enabled);

  const sections: string[] = [];
  sections.push(runtime.stackRules(ds));

  sections.push(`# Design system: ${ds.name}
Every visible element must come from ${ds.name} (package \`${ds.packageName}@${ds.version}\`). This app is a prototype that the product team will merge into a product built on the same design system, so fidelity matters more than visual flair.

Rules:
- Compose screens from the components in the catalog below, importing from the exact import path listed for each one.
- Only use components and props that are listed. If something you need does not exist, compose it from listed components and say so in your reply. Never invent a component or prop.
- Do not install or import any other UI kit, icon set, CSS framework or CSS-in-JS library (for example ${FOREIGN_UI_PACKAGES.slice(0, 6).map((p) => p.replace(/\/$/, "")).join(", ")}, Tailwind).${
    natives.length
      ? `\n- Use design system components instead of raw elements: ${natives.map(([el, name]) => `${name} instead of <${el}>`).join(", ")}.`
      : ""
  }
- Styling is for layout only (flex, grid, gaps, widths). Prefer the design system's own layout components when they exist.${
    ds.tokens.length
      ? " For any color, spacing, radius, shadow or font value, use the design tokens listed below as CSS variables. Never hard-code hex colors or font stacks."
      : " Never hard-code colors or font stacks."
  }
- The design system stylesheet and provider are already set up${ds.setup.globalCss.length ? ` (${ds.setup.globalCss.join(", ")})` : ""}${
    ds.setup.provider ? ` with <${ds.setup.provider.importName}> at the root` : ""
  }.`);

  if (ds.guidelines.trim()) {
    sections.push(`# Guidelines from the ${ds.name} team\n${ds.guidelines.trim()}`);
  }

  if (common.length) {
    sections.push(
      `# Props shared by many components\nThese props are accepted by most components and are omitted from the entries below:\n${common
        .map((p) => `- ${formatProp(p)}`)
        .join("\n")}`,
    );
  }

  sections.push(
    `# Component catalog (${enabled.length} components)\nFormat: name - description. usage. props (* = required).\n\n${enabled
      .map((c) => formatComponent(c, commonNames, runtime.kit.usage(c)))
      .join("\n")}`,
  );

  if (ds.tokens.length) {
    sections.push(`# Design tokens (CSS custom properties)\n${ds.tokens.join(" ")}`);
  }

  return sections.join("\n\n");
}

function formatComponent(c: ComponentInfo, skip: Set<string>, usage: string): string {
  const props = c.props.filter((p) => !skip.has(p.name));
  const lines = [`## ${c.name}${c.description ? ` - ${oneLine(c.description)}` : ""}`, `usage: ${usage}`];
  if (c.extendsNative && c.extendsNative !== "element") lines.push(`accepts all native <${c.extendsNative}> attributes`);
  if (props.length) lines.push(`props: ${props.map(formatProp).join("; ")}`);
  if (c.events?.length) lines.push(`events: ${c.events.join(", ")}`);
  for (const example of c.examples ?? []) lines.push(`example:\n${example.trim()}`);
  return lines.join("\n");
}

function formatProp(p: PropInfo): string {
  return `${p.name}${p.required ? "*" : ""}: ${p.type}`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Props that appear on a large share of components, keyed by name and type. */
export function commonProps(components: ComponentInfo[]): PropInfo[] {
  if (components.length < COMMON_PROP_MIN_COMPONENTS) return [];
  const counts = new Map<string, { prop: PropInfo; n: number }>();
  for (const c of components) {
    for (const p of c.props) {
      const key = `${p.name}\u0000${p.type}`;
      const entry = counts.get(key) ?? { prop: { ...p, required: false }, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  const threshold = Math.max(COMMON_PROP_MIN_COMPONENTS, components.length * COMMON_PROP_SHARE);
  return [...counts.values()]
    .filter((e) => e.n >= threshold)
    .map((e) => e.prop)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const REPLACEABLE = new Set(["button", "input", "select", "textarea", "a", "table", "dialog", "form"]);

/** Native element to the preferred design system component that wraps it. */
export function nativeReplacements(components: ComponentInfo[]): [string, string][] {
  const out = new Map<string, string>();
  for (const c of components) {
    const el = c.extendsNative;
    if (!el || !REPLACEABLE.has(el)) continue;
    const current = out.get(el);
    // Prefer the shortest name: `Button` over `IconButton`.
    if (!current || c.name.length < current.length) out.set(el, c.name);
  }
  return [...out.entries()];
}
