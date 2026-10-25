/**
 * Built-in Figma connector over the REST API with a personal access token.
 * It offers three read-only tools: a simplified node tree for a Figma link,
 * a PNG render of it, and the file's published components.
 */
import type { ToolImage, ToolOutput } from "../chat/tools";

const API = "https://api.figma.com/v1";
const MAX_NODES = 600;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface FigmaToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const URL_INPUT = {
  type: "object",
  properties: { url: { type: "string", description: "A figma.com link to a file, frame or layer (design, file, proto or board URL)." } },
  required: ["url"],
};

export const FIGMA_TOOLS: FigmaToolDef[] = [
  {
    name: "get_design",
    description:
      "Reads the layer tree of a Figma frame or file: names, types, sizes, auto layout, text, colors and which components are used. Use it before building a screen from a Figma link. Without a node-id in the link it lists the pages and top-level frames.",
    inputSchema: URL_INPUT,
  },
  {
    name: "get_screenshot",
    description: "Renders the Figma frame or layer in the link as a PNG, to see the layout. The link must include a node-id.",
    inputSchema: {
      ...URL_INPUT,
      properties: { ...URL_INPUT.properties, scale: { type: "number", description: "Render scale from 0.5 to 2. Defaults to 1." } },
    },
  },
  {
    name: "list_components",
    description: "Lists the published components and component sets in the Figma file, with descriptions, to map design components onto design system components.",
    inputSchema: URL_INPUT,
  },
];

export interface FigmaLink {
  fileKey: string;
  /** API form, "12:34". */
  nodeId?: string;
}

/** Parses figma.com/design|file|proto|board/<key>/...?node-id=12-34 links. */
export function parseFigmaUrl(raw: string): FigmaLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Pass a full figma.com link.");
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) throw new Error("The link must be on figma.com.");
  const match = /\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/.exec(url.pathname);
  if (!match) throw new Error("This doesn't look like a Figma file link.");
  const nodeParam = url.searchParams.get("node-id");
  return { fileKey: match[2] ?? match[1], nodeId: nodeParam ? nodeParam.replace(/-/g, ":") : undefined };
}

export async function callFigmaTool(token: string, name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  const args = (input ?? {}) as { url?: unknown; scale?: unknown };
  if (typeof args.url !== "string") throw new Error("Pass the Figma link as `url`.");
  const link = parseFigmaUrl(args.url);
  switch (name) {
    case "get_design":
      return text(await getDesign(token, link, signal));
    case "get_screenshot":
      return getScreenshot(token, link, typeof args.scale === "number" ? args.scale : 1, signal);
    case "list_components":
      return text(await listComponents(token, link, signal));
    default:
      throw new Error(`Unknown Figma tool: ${name}`);
  }
}

/** Checks the token by reading the signed-in user. */
export async function checkFigmaToken(token: string, signal?: AbortSignal): Promise<string> {
  const me = (await figma(token, "/me", signal)) as { handle?: string; email?: string };
  return me.handle ?? me.email ?? "Figma user";
}

async function getDesign(token: string, link: FigmaLink, signal: AbortSignal): Promise<string> {
  if (!link.nodeId) {
    const file = (await figma(token, `/files/${link.fileKey}?depth=2`, signal)) as { name: string; document: FigmaNode };
    const pages = (file.document.children ?? []).map((page) => ({
      page: page.name,
      frames: (page.children ?? []).map((f) => ({ name: f.name, type: f.type, nodeId: f.id })),
    }));
    return JSON.stringify({ file: file.name, note: "Add ?node-id=<nodeId> (with - instead of :) to a link to read one frame.", pages }, null, 1);
  }
  const res = (await figma(token, `/files/${link.fileKey}/nodes?ids=${encodeURIComponent(link.nodeId)}`, signal)) as {
    name: string;
    nodes: Record<string, { document: FigmaNode; components?: Record<string, { name: string; description?: string }> } | null>;
  };
  const entry = res.nodes[link.nodeId];
  if (!entry) throw new Error(`Node ${link.nodeId} was not found in the file.`);
  const counter = { n: 0 };
  const tree = simplify(entry.document, entry.components ?? {}, counter);
  return JSON.stringify(
    { file: res.name, node: link.nodeId, ...(counter.n >= MAX_NODES ? { note: `Only the first ${MAX_NODES} layers are included.` } : {}), tree },
    null,
    1,
  );
}

async function getScreenshot(token: string, link: FigmaLink, scale: number, signal: AbortSignal): Promise<ToolOutput> {
  if (!link.nodeId) throw new Error("The link needs a node-id to render. Select a frame in Figma and copy its link.");
  const s = Math.min(2, Math.max(0.5, scale));
  const res = (await figma(token, `/images/${link.fileKey}?ids=${encodeURIComponent(link.nodeId)}&format=png&scale=${s}`, signal)) as {
    images: Record<string, string | null>;
    err?: string | null;
  };
  const imageUrl = res.images[link.nodeId];
  if (!imageUrl) throw new Error(res.err ?? "Figma could not render this node.");
  const png = await fetch(imageUrl, { signal });
  if (!png.ok) throw new Error(`Downloading the render failed (${png.status}).`);
  const bytes = Buffer.from(await png.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    return text(`The render is ${(bytes.length / 1e6).toFixed(1)} MB, over the 4 MB limit. Try a smaller scale or a smaller frame.`, true);
  }
  const image: ToolImage = { mediaType: "image/png", data: bytes.toString("base64") };
  return { text: `Rendered node ${link.nodeId} at ${s}x.`, images: [image], isError: false };
}

async function listComponents(token: string, link: FigmaLink, signal: AbortSignal): Promise<string> {
  const [components, sets] = (await Promise.all([
    figma(token, `/files/${link.fileKey}/components`, signal),
    figma(token, `/files/${link.fileKey}/component_sets`, signal),
  ])) as [{ meta?: { components?: FigmaComponent[] } }, { meta?: { component_sets?: FigmaComponent[] } }];
  const pick = (c: FigmaComponent) => ({ name: c.name, description: c.description || undefined, page: c.containing_frame?.pageName, nodeId: c.node_id });
  return JSON.stringify(
    { componentSets: (sets.meta?.component_sets ?? []).map(pick), components: (components.meta?.components ?? []).map(pick) },
    null,
    1,
  );
}

interface FigmaComponent {
  name: string;
  description?: string;
  node_id?: string;
  containing_frame?: { pageName?: string };
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: { width: number; height: number } | null;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  characters?: string;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number };
  fills?: { type: string; visible?: boolean; color?: { r: number; g: number; b: number; a: number } }[];
  cornerRadius?: number;
  componentId?: string;
  componentProperties?: Record<string, { value: unknown }>;
}

/** Keeps what a developer needs to rebuild the layout with design system components. */
function simplify(node: FigmaNode, components: Record<string, { name: string; description?: string }>, counter: { n: number }): unknown {
  counter.n++;
  const out: Record<string, unknown> = { name: node.name, type: node.type };
  const box = node.absoluteBoundingBox;
  if (box) out.size = `${Math.round(box.width)}x${Math.round(box.height)}`;
  if (node.layoutMode && node.layoutMode !== "NONE") {
    out.layout = {
      direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
      gap: node.itemSpacing,
      padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map((p) => p ?? 0).join(" "),
      align: [node.primaryAxisAlignItems, node.counterAxisAlignItems].filter(Boolean).join("/") || undefined,
    };
  }
  if (node.characters) out.text = node.characters.slice(0, 500);
  if (node.style?.fontSize) out.font = `${node.style.fontFamily ?? ""} ${node.style.fontSize}/${node.style.fontWeight ?? 400}`.trim();
  const fill = node.fills?.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
  if (fill?.color) out.fill = hex(fill.color);
  if (node.cornerRadius) out.radius = node.cornerRadius;
  if (node.componentId) {
    out.component = components[node.componentId]?.name ?? node.componentId;
    if (node.componentProperties) {
      out.props = Object.fromEntries(Object.entries(node.componentProperties).map(([k, v]) => [k.replace(/#[\d:]+$/, ""), v.value]));
    }
  }
  const children = (node.children ?? []).filter((c) => c.visible !== false);
  // Component instances are summarized by their component and props, not their internals.
  if (children.length && node.type !== "INSTANCE") {
    const kids: unknown[] = [];
    for (const c of children) {
      if (counter.n >= MAX_NODES) break;
      kids.push(simplify(c, components, counter));
    }
    out.children = kids;
  }
  return out;
}

function hex(c: { r: number; g: number; b: number; a: number }): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ""}`;
}

async function figma(token: string, path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(API + path, { headers: { "X-Figma-Token": token }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.ok) return res.json();
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { err?: string; message?: string };
    detail = body.err ?? body.message ?? detail;
  } catch {
    // Keep the status text.
  }
  if (res.status === 403) throw new Error(`Figma denied access (${detail}). Check the token and that it can read this file.`);
  if (res.status === 404) throw new Error(`Figma could not find this file (${detail}).`);
  if (res.status === 429) throw new Error("Figma rate limited the request. Wait a minute and try again.");
  throw new Error(`Figma API error (${res.status}): ${detail}`);
}

function text(t: string, isError = false): ToolOutput {
  return { text: t, images: [], isError };
}
