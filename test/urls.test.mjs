// Behavioral guard for the Studio-hidden output fix: the /studio/<id> pages
// were removed from the web app (they redirect to /library), so every design
// link the tools emit must be the /share/<id> page that exists today.
// These tests drive the real MCP tool handlers over an in-memory transport
// with a stubbed engine client and assert on the observable tool output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/server.ts";

function stubClient({ designs = [], bundle = "# bundle" } = {}) {
  return {
    json: async (method, path) => {
      if (method === "GET" && path === "/designs") return { designs };
      throw new Error(`unexpected engine call ${method} ${path}`);
    },
    text: async () => bundle,
    bytes: async () => null,
    streamUntilDone: async () => true,
  };
}

async function callTool(engine, name, args = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(engine);
  await server.connect(serverTransport);
  const client = new Client({ name: "url-test", version: "0" });
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

const textOf = (res) => res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("list_designs emits share links, never studio links", async () => {
  const res = await callTool(
    stubClient({ designs: [{ id: "abc123", appName: "Demo", brief: "a demo app", screens: 2 }] }),
    "list_designs",
  );
  const out = textOf(res);
  assert.match(out, /https:\/\/v-1\.design\/share\/abc123/);
  assert.doesNotMatch(out, /\/studio\//);
});

test("get_design markdown bundle appends a share link, never a studio link", async () => {
  const res = await callTool(stubClient(), "get_design", { projectId: "abc123" });
  const out = textOf(res);
  assert.match(out, /\/share\/abc123/);
  assert.doesNotMatch(out, /\/studio\//);
});

test("get_design still accepts a legacy studio URL as input", async () => {
  const res = await callTool(stubClient(), "get_design", { projectId: "https://v-1.design/studio/abc123" });
  assert.match(textOf(res), /\/share\/abc123/);
});

test("get_design json output stays pure (no appended link)", async () => {
  const res = await callTool(stubClient({ bundle: "BUNDLE" }), "get_design", {
    projectId: "abc123",
    format: "json",
  });
  assert.equal(textOf(res), "BUNDLE");
});
