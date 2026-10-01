import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuns } from "../node_modules/@byokit/openclaw/dist/runs.js";
import { runJobAndSubmit } from "../src/cli/host.mjs";

// Exercise the installed published kit with an exclusively local transport.
// No gateway, credentials or provider is involved in this replay.
const complete = JSON.stringify({ appName: "Umer", content: "x".repeat(25421) });

async function replay({ terminalReply, payloads = [{ text: complete }], json = true }) {
  let event;
  let request;
  let end;
  const callbacks = [];
  const submissions = [];
  const runs = createRuns({
    ensure: async () => ({ agentId: "me" }),
    bridge: { register: () => () => {} },
    tools: new Set(),
    onEvent: (fn) => { event = fn; return () => {}; },
    request: async (method, params, options) => {
      if (method === "models.authStatus") return { providers: [{ provider: "openai", status: "ok" }] };
      if (method === "agent") {
        request = params;
        options.onAccepted({ runId: "offline" });
        event({ event: "agent", payload: { runId: "offline", stream: "assistant", data: { text: complete } } });
        return { runId: "offline", result: { payloads } };
      }
      if (method === "agent.wait") return { runId: "offline", status: "ok", terminalReply };
      throw new Error(`Unexpected offline request: ${method}`);
    },
  });
  const schema = { type: "object", required: ["appName", "content"], properties: { appName: { type: "string" }, content: { type: "string" } } };
  const outcome = await runJobAndSubmit({
    kit: { run: async (spec) => { end = await runs.run(spec, (e) => callbacks.push(e)); return end; } },
    client: { submit: async (id, body) => { submissions.push([id, body]); } },
    job: { id: "offline", input: { message: "Build for Umer", model: "openai/gpt-test", role: "planner", system: "Return the complete plan", json, ...(json ? { schema } : {}) } },
  });
  if (json) assert.ok(request.extraSystemPrompt.includes(JSON.stringify(schema)));
  return { end, callbacks, submissions, outcome };
}

for (const capped of [true, false]) {
  test(`published kit submits complete JSON with capped terminal=${capped}`, async () => {
    assert.equal(complete.length, 25452);
    const result = await replay({ terminalReply: capped ? { disposition: "visible", text: complete.slice(0, 4095) + "…" } : undefined });
    assert.deepEqual(JSON.parse(result.end.text), JSON.parse(complete));
    assert.equal(result.end.text, complete);
    assert.equal(result.callbacks.at(-1).text, complete);
    assert.deepEqual(result.submissions, [["offline", { result: { text: complete } }]]);
    assert.deepEqual(result.outcome, { result: { text: complete } });
  });
}

test("complete cumulative stream survives when the final frame has no text payload", async () => {
  const result = await replay({ payloads: [], terminalReply: { disposition: "visible", text: "capped" } });
  assert.equal(result.end.text, complete);
  assert.equal(result.outcome.result.text, complete);
});

for (const disposition of ["silent", "empty"]) {
  test(`terminal ${disposition} suppresses payload and transient stream`, async () => {
    const result = await replay({ terminalReply: { disposition, text: "" }, json: false });
    assert.equal(result.end.text, "");
    assert.equal(result.callbacks.at(-1).text, "");
    assert.deepEqual(result.submissions, [["offline", { result: { text: "" } }]]);
    const jsonResult = await replay({ terminalReply: { disposition, text: "" } });
    assert.match(jsonResult.outcome.error, /^invalid-result:/);
    assert.deepEqual(jsonResult.submissions, [["offline", { error: jsonResult.outcome.error }]]);
  });
}
