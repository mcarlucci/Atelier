/**
 * Writes a design system's compiled Invariant contract as a standalone MCP server folder. The folder holds the
 * contract files the CLI's `mcp` command reads and a README with the client config, so any MCP client can serve
 * the design system without Atelier. It never overwrites an existing folder.
 */
import fs from "node:fs";
import path from "node:path";
import { INVARIANT_PACKAGE } from "./runner";

const REQUIRED_FILES = ["invariant.contract.json", "invariant.evidence.json"];
const OPTIONAL_FILES = ["invariant.manifest.json"];

export interface McpExportOptions {
  /** The compiled contract folder (the design system's Invariant output). */
  contractDir: string;
  /** The new folder's path. Must not exist yet. */
  folder: string;
  name: string;
  packageName: string;
  /** Version of @invariant-ui/cli the server runs. Must match the contract's format. */
  cliVersion: string;
}

/** A lowercase, hyphenated slug for the folder and the MCP server key, such as "acme-ui". */
export function mcpServerSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design-system";
}

/** Returns the new folder's path. */
export function exportMcpServer(opts: McpExportOptions): string {
  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(opts.contractDir, f))) {
      throw new Error("This design system has no compiled contract. Recompile it under Compliance first.");
    }
  }
  const { folder } = opts;
  const slug = mcpServerSlug(opts.name);
  if (fs.existsSync(folder)) {
    throw new Error(`${path.basename(folder)} already exists. Choose another name or move the existing folder first.`);
  }
  try {
    fs.mkdirSync(folder, { recursive: true });
    for (const f of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
      const from = path.join(opts.contractDir, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(folder, f));
    }
    fs.writeFileSync(path.join(folder, "README.md"), readme(slug, folder, opts));
  } catch (err) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw err;
  }
  return folder;
}

function readme(slug: string, folder: string, opts: McpExportOptions): string {
  const config = {
    mcpServers: {
      [slug]: {
        command: "npx",
        args: ["-y", `${INVARIANT_PACKAGE}@${opts.cliVersion}`, "mcp", "--cwd", folder, "--dir", "."],
      },
    },
  };
  return `# ${opts.name} design system MCP server

Serves the compiled Invariant UI contract for ${opts.name} (\`${opts.packageName}\`) to AI tools over MCP.
The server is read-only and needs no other files from the design system.

## Connect a client

Add this to the client's MCP configuration (for example \`claude_desktop_config.json\`, Cursor's \`mcp.json\`, or a project \`.mcp.json\`):

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

Requires Node.js 20 or newer. The first start downloads \`${INVARIANT_PACKAGE}@${opts.cliVersion}\` with npx.

If you move this folder, change the \`--cwd\` path in the config.

## Update

Export again from Atelier after the design system is re-imported or recompiled. Atelier does not update exported folders.
`;
}
