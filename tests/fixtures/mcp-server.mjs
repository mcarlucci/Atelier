// A tiny design-system docs MCP server for tests, served over stdio or, with
// --http <port>, over Streamable HTTP.
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function build() {
  const server = new McpServer({ name: "ds-docs", version: "1.0.0" });
  server.registerTool(
    "get_component",
    {
      description: "Docs for one component",
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => ({ content: [{ type: "text", text: `${name}: use variant="solid" for primary actions. Token: ${process.env.DOCS_TOKEN ?? "none"}` }] }),
  );
  server.registerTool(
    "publish_tokens",
    { description: "Publishes tokens", inputSchema: {}, annotations: { readOnlyHint: false } },
    async () => ({ content: [{ type: "text", text: "published" }] }),
  );
  return server;
}

const httpIndex = process.argv.indexOf("--http");
if (httpIndex > 0) {
  const port = Number(process.argv[httpIndex + 1]);
  http
    .createServer(async (req, res) => {
      if (req.headers.authorization !== "Bearer secret-token") {
        res.writeHead(401).end();
        return;
      }
      // Stateless: one server and transport per request.
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })
    .listen(port, "127.0.0.1", () => console.log("ready"));
} else {
  await build().connect(new StdioServerTransport());
}
