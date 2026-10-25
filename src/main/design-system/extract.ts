import ts from "typescript";
import type { ComponentInfo, FrameworkId, PropInfo } from "@shared/types";

export interface EntryPoint {
  /** Absolute path to a .d.ts (or .ts) file. */
  file: string;
  /** Module specifier consumers import from. */
  importPath: string;
}

export interface ExtractResult {
  components: ComponentInfo[];
  warnings: string[];
}

const MAX_PROPS = 40;
const MAX_TYPE_LENGTH = 160;

/**
 * Builds a component catalog from a design system's published type
 * declarations. Declarations are the one artifact every React, Vue and
 * Angular library ships, so no framework runtime or build step is needed.
 */
export function extractComponents(entries: EntryPoint[], framework: FrameworkId): ExtractResult {
  const warnings: string[] = [];
  const program = ts.createProgram(
    entries.map((e) => e.file),
    {
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  const byName = new Map<string, ComponentInfo>();

  for (const entry of entries) {
    const source = program.getSourceFile(entry.file);
    if (!source) {
      warnings.push(`Could not load type declarations: ${entry.file}`);
      continue;
    }
    // Subpaths such as `vuetify/styles` declare no exports; they just hold no components.
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    const exports = checker.getExportsOfModule(moduleSymbol);
    const found =
      framework === "react"
        ? extractReact(checker, exports, entry.importPath)
        : framework === "vue"
          ? extractVue(checker, exports, entry.importPath)
          : extractAngular(checker, exports, entry.importPath);
    for (const component of found) {
      // The first entry point wins, so root-barrel imports are preferred over subpaths.
      if (!byName.has(component.name)) byName.set(component.name, component);
    }
  }

  const components = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (components.length === 0) {
    warnings.push(
      `No ${framework} components were detected. Check the framework choice, or add components through a manifest override.`,
    );
  }
  return { components, warnings };
}

// ---------------------------------------------------------------- React

function extractReact(checker: ts.TypeChecker, exports: ts.Symbol[], importPath: string): ComponentInfo[] {
  const result: ComponentInfo[] = [];
  for (const exported of exports) {
    const symbol = resolveAlias(checker, exported);
    const named = componentName(exported, symbol, importPath);
    if (!named) continue;
    const { name, defaultExport } = named;
    const type = valueType(checker, symbol);
    if (!type) continue;

    const props = reactPropsType(checker, type);
    if (props) {
      result.push({ ...buildComponent(checker, name, importPath, symbol, props), ...(defaultExport && { defaultExport }) });
      continue;
    }
    // Compound components such as `Dialog.Root`, `Tabs.List`.
    for (const member of checker.getPropertiesOfType(type)) {
      const memberName = member.getName();
      if (!isPascalCase(memberName)) continue;
      const decl = member.valueDeclaration ?? member.declarations?.[0];
      if (!decl) continue;
      const memberType = checker.getTypeOfSymbolAtLocation(member, decl);
      const memberProps = reactPropsType(checker, memberType);
      if (memberProps) {
        result.push({
          ...buildComponent(checker, `${name}.${memberName}`, importPath, member, memberProps),
          ...(defaultExport && { defaultExport }),
        });
      }
    }
  }
  return result;
}

/** Returns the props type when `type` is a React component, otherwise null. */
function reactPropsType(checker: ts.TypeChecker, type: ts.Type): ts.Type | null {
  for (const signature of type.getConstructSignatures()) {
    const instance = signature.getReturnType();
    const props = instance.getProperty("props");
    const render = instance.getProperty("render");
    if (props && render) {
      const decl = props.valueDeclaration ?? props.declarations?.[0];
      return decl ? checker.getTypeOfSymbolAtLocation(props, decl) : null;
    }
  }
  const signatures = type.getCallSignatures();
  if (signatures.length === 0) return null;
  const signature = signatures[0];
  const returned = checker.typeToString(signature.getReturnType());
  if (!/Element|ReactNode|ReactPortal|JSX/.test(returned)) return null;
  const param = signature.getParameters()[0];
  if (!param) return checker.getAnyType();
  const decl = param.valueDeclaration ?? param.declarations?.[0];
  return decl ? checker.getTypeOfSymbolAtLocation(param, decl) : checker.getAnyType();
}

function buildComponent(
  checker: ts.TypeChecker,
  name: string,
  importPath: string,
  symbol: ts.Symbol,
  propsType: ts.Type,
): ComponentInfo {
  const { props, extendsNative } = collectProps(checker, propsType, isReactNativeAttribute);
  return {
    name,
    importPath,
    description: docOf(checker, symbol),
    props,
    extendsNative,
    enabled: true,
  };
}

function isReactNativeAttribute(file: string): boolean {
  return /[\\/]@types[\\/]react[\\/]|[\\/]csstype[\\/]|[\\/]typescript[\\/]lib[\\/]/.test(file);
}

// ---------------------------------------------------------------- Vue

function extractVue(checker: ts.TypeChecker, exports: ts.Symbol[], importPath: string): ComponentInfo[] {
  const result: ComponentInfo[] = [];
  for (const exported of exports) {
    const symbol = resolveAlias(checker, exported);
    const named = componentName(exported, symbol, importPath);
    if (!named) continue;
    const { name, defaultExport } = named;
    const type = valueType(checker, symbol);
    if (!type) continue;
    const propsType = vuePropsType(checker, type);
    if (!propsType) continue;
    const { props, extendsNative } = collectProps(checker, propsType, isVueRuntimeAttribute);
    const events = props.filter((p) => /^on[A-Z]/.test(p.name)).map((p) => vueEventName(p.name));
    result.push({
      name,
      importPath,
      ...(defaultExport && { defaultExport }),
      description: docOf(checker, symbol),
      props: props.filter((p) => !/^on[A-Z]/.test(p.name)),
      events,
      extendsNative,
      enabled: true,
    });
  }
  return result;
}

/** Vue components (DefineComponent and friends) construct an instance carrying `$props`. */
function vuePropsType(checker: ts.TypeChecker, type: ts.Type): ts.Type | null {
  for (const signature of type.getConstructSignatures()) {
    const instance = signature.getReturnType();
    const $props = instance.getProperty("$props");
    const decl = $props?.valueDeclaration ?? $props?.declarations?.[0];
    if ($props && decl) return checker.getTypeOfSymbolAtLocation($props, decl);
  }
  return null;
}

function isVueRuntimeAttribute(file: string): boolean {
  return /[\\/](vue|@vue[\\/][^\\/]+)[\\/]|[\\/]csstype[\\/]|[\\/]typescript[\\/]lib[\\/]/.test(file);
}

function vueEventName(prop: string): string {
  const raw = prop.slice(2);
  return raw.charAt(0).toLowerCase() + raw.slice(1).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// ---------------------------------------------------------------- Angular

function extractAngular(checker: ts.TypeChecker, exports: ts.Symbol[], importPath: string): ComponentInfo[] {
  const result: ComponentInfo[] = [];
  /** Component class name to the NgModule that exports it. */
  const moduleFor = new Map<string, string>();

  for (const exported of exports) {
    const symbol = resolveAlias(checker, exported);
    const decl = symbol.declarations?.find(ts.isClassDeclaration);
    if (!decl) continue;
    const mod = staticTypeArgs(decl, "ɵmod");
    if (mod && mod[3] && ts.isTupleTypeNode(mod[3])) {
      for (const element of mod[3].elements) {
        const ref = ts.isTypeQueryNode(element) ? element.exprName.getText() : element.getText();
        const exportedName = ref.replace(/^typeof\s+/, "").split(".").pop() ?? ref;
        if (!moduleFor.has(exportedName)) moduleFor.set(exportedName, exported.getName());
      }
    }
  }

  for (const exported of exports) {
    const name = exported.getName();
    const symbol = resolveAlias(checker, exported);
    const decl = symbol.declarations?.find(ts.isClassDeclaration);
    if (!decl) continue;
    const args = staticTypeArgs(decl, "ɵcmp");
    if (!args) continue;

    const selector = literalText(args[1]) ?? undefined;
    const classType = checker.getDeclaredTypeOfSymbol(symbol);
    const props: PropInfo[] = [];
    for (const input of objectEntries(args[3])) {
      const member = classType.getProperty(input.key);
      const memberDecl = member?.valueDeclaration ?? member?.declarations?.[0];
      const rawType =
        member && memberDecl
          ? checker.typeToString(checker.getTypeOfSymbolAtLocation(member, memberDecl))
          : "unknown";
      props.push({
        name: input.alias ?? input.key,
        type: shorten(unwrapAngularSignal(rawType)),
        required: input.required,
        description: member ? docOf(checker, member) : undefined,
      });
    }
    const events = objectEntries(args[4]).map((o) => o.alias ?? o.key);
    const standalone = literalBoolean(args[7]);
    result.push({
      name,
      importPath,
      selector,
      description: docOf(checker, symbol),
      props: props.slice(0, MAX_PROPS),
      events,
      angularImport: standalone === false ? (moduleFor.get(name) ?? name) : name,
      enabled: true,
    });
  }
  return result;
}

/** Type arguments of `static <member>: i0.ɵɵXDeclaration<...>` in an Angular .d.ts. */
function staticTypeArgs(decl: ts.ClassDeclaration, member: string): readonly ts.TypeNode[] | null {
  for (const m of decl.members) {
    if (!ts.isPropertyDeclaration(m) || m.name.getText() !== member) continue;
    if (m.type && ts.isTypeReferenceNode(m.type) && m.type.typeArguments) return m.type.typeArguments;
  }
  return null;
}

/** Reads `{ "key": "alias"; }` or `{ "key": { "alias": "a"; "required": true; ... }; }`. */
function objectEntries(node: ts.TypeNode | undefined): { key: string; alias?: string; required: boolean }[] {
  if (!node || !ts.isTypeLiteralNode(node)) return [];
  const out: { key: string; alias?: string; required: boolean }[] = [];
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const key = member.name.getText().replace(/^["']|["']$/g, "");
    const direct = literalText(member.type);
    if (direct !== null) {
      out.push({ key, alias: direct || undefined, required: false });
      continue;
    }
    if (ts.isTypeLiteralNode(member.type)) {
      let alias: string | undefined;
      let required = false;
      for (const field of member.type.members) {
        if (!ts.isPropertySignature(field) || !field.type) continue;
        const fieldName = field.name.getText().replace(/^["']|["']$/g, "");
        if (fieldName === "alias") alias = literalText(field.type) ?? undefined;
        if (fieldName === "required") required = literalBoolean(field.type) === true;
      }
      out.push({ key, alias, required });
    }
  }
  return out;
}

function literalText(node: ts.TypeNode | undefined): string | null {
  if (node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return node.literal.text;
  return null;
}

function literalBoolean(node: ts.TypeNode | undefined): boolean | null {
  if (!node || !ts.isLiteralTypeNode(node)) return null;
  if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function unwrapAngularSignal(type: string): string {
  const match = /^(?:\w+\.)?(?:InputSignal|InputSignalWithTransform|ModelSignal)<(.+)>$/.exec(type);
  if (!match) return type;
  // InputSignalWithTransform<T, TransformT>: keep the first argument.
  let depth = 0;
  for (let i = 0; i < match[1].length; i++) {
    const c = match[1][i];
    if (c === "<" || c === "(" || c === "{" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) return match[1].slice(0, i).trim();
  }
  return match[1];
}

// ---------------------------------------------------------------- shared

function collectProps(
  checker: ts.TypeChecker,
  propsType: ts.Type,
  isFrameworkAttribute: (file: string) => boolean,
): { props: PropInfo[]; extendsNative?: string } {
  const props: PropInfo[] = [];
  const nativeInterfaces = new Map<string, number>();
  let nativeCount = 0;

  for (const prop of checker.getPropertiesOfType(checker.getApparentType(propsType))) {
    const name = prop.getName();
    // `$children`, `$slots` and similar are framework plumbing, not props a template sets.
    if (name === "key" || name === "ref" || name.startsWith("__") || name.startsWith("$")) continue;
    const decls = prop.declarations ?? [];
    const inherited =
      decls.length > 0 && decls.every((d) => isFrameworkAttribute(d.getSourceFile().fileName));
    if (inherited) {
      nativeCount++;
      const parent = decls[0].parent;
      if (parent && ts.isInterfaceDeclaration(parent)) {
        const iface = parent.name.text;
        nativeInterfaces.set(iface, (nativeInterfaces.get(iface) ?? 0) + 1);
      }
      continue;
    }
    const decl = prop.valueDeclaration ?? decls[0];
    const type = decl ? checker.getTypeOfSymbolAtLocation(prop, decl) : checker.getAnyType();
    props.push({
      name,
      type: shorten(
        checker
          .typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType)
          .replace(/ \| undefined$/, ""),
      ),
      required: (prop.flags & ts.SymbolFlags.Optional) === 0,
      description: docOf(checker, prop),
    });
  }

  props.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
  return { props: props.slice(0, MAX_PROPS), extendsNative: nativeCount > 15 ? nativeElement(nativeInterfaces) : undefined };
}

/** `ButtonHTMLAttributes` -> `button`. Falls back to a generic element. */
function nativeElement(interfaces: Map<string, number>): string {
  let best: string | undefined;
  for (const iface of interfaces.keys()) {
    const match = /^(\w+?)HTMLAttributes$/.exec(iface);
    if (match && match[1] !== "All" && match[1] !== "") best = match[1].toLowerCase();
  }
  if (best === "anchor") return "a";
  if (best === "textarea" || best === "input" || best === "select" || best === "button" || best === "form") return best;
  return best ?? "element";
}

function valueType(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | null {
  const decl = symbol.valueDeclaration ?? symbol.declarations?.find((d) => !ts.isTypeAliasDeclaration(d) && !ts.isInterfaceDeclaration(d));
  if (!decl) return null;
  if ((symbol.flags & ts.SymbolFlags.Value) === 0) return null;
  return checker.getTypeOfSymbolAtLocation(symbol, decl);
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function docOf(checker: ts.TypeChecker, symbol: ts.Symbol): string | undefined {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  return text ? text.split("\n\n")[0].slice(0, 400) : undefined;
}

/**
 * The name a component is imported by. A default export is named after its
 * declaration (`declare const Button`) or, failing that, its subpath.
 */
function componentName(
  exported: ts.Symbol,
  symbol: ts.Symbol,
  importPath: string,
): { name: string; defaultExport?: boolean } | null {
  const name = exported.getName();
  if (name !== "default") return isPascalCase(name) ? { name } : null;
  const declared = symbol.getName();
  if (isPascalCase(declared)) return { name: declared, defaultExport: true };
  const segment = importPath.split("/").pop() ?? "";
  const fromPath = segment.replace(/(^|[-_.])([a-z0-9])/g, (_, _sep: string, c: string) => c.toUpperCase());
  return isPascalCase(fromPath) ? { name: fromPath, defaultExport: true } : null;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function shorten(type: string): string {
  return type.length > MAX_TYPE_LENGTH ? `${type.slice(0, MAX_TYPE_LENGTH - 1)}…` : type;
}
