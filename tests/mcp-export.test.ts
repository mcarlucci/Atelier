import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportMcpServer, mcpServerSlug } from "../src/main/invariant/export";

function contractDir(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-contract-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "{}");
  return dir;
}

const opts = (contract: string, folder: string) => ({
  contractDir: contract,
  folder,
  name: "Acme UI",
  packageName: "@acme/ui",
  cliVersion: "0.3.0",
});

describe("exportMcpServer", () => {
  it("copies the contract files and writes a README with an absolute --cwd config", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-parent-"));
    const folder = path.join(parent, "acme-ui-mcp");
    exportMcpServer(opts(contractDir(["invariant.contract.json", "invariant.evidence.json", "invariant.report.html"]), folder));

    expect(fs.readdirSync(folder).sort()).toEqual(["README.md", "invariant.contract.json", "invariant.evidence.json"]);
    const readme = fs.readFileSync(path.join(folder, "README.md"), "utf8");
    const config = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(readme)![1]) as { mcpServers: Record<string, { args: string[] }> };
    expect(config.mcpServers["acme-ui"].args).toEqual(["-y", "@invariant-ui/cli@0.3.0", "mcp", "--cwd", folder, "--dir", "."]);
  });

  it("refuses to overwrite an existing folder", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-parent-"));
    const folder = path.join(parent, "acme-ui-mcp");
    fs.mkdirSync(folder);
    expect(() => exportMcpServer(opts(contractDir(["invariant.contract.json", "invariant.evidence.json"]), folder))).toThrow(/already exists/);
  });

  it("fails without a compiled contract and leaves no folder behind", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-parent-"));
    const folder = path.join(parent, "acme-ui-mcp");
    expect(() => exportMcpServer(opts(contractDir(["invariant.contract.json"]), folder))).toThrow(/no compiled contract/);
    expect(fs.existsSync(folder)).toBe(false);
  });

  it("slugs design system names", () => {
    expect(mcpServerSlug("  Acme — UI 2.0 ")).toBe("acme-ui-2-0");
    expect(mcpServerSlug("!!!")).toBe("design-system");
  });
});
