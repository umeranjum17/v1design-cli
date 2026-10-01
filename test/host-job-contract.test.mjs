// Studio Phase 0 (X1): the shared host job wire contract test, CLI lane.
//
// Fixture copied verbatim from the engine
// (v1-design-engine src/lib/agent/__tests__/host-job-contract.fixture.json).
// Runs against the CLI's own `runJobAndSubmit`: any wire drift fails here and
// on the engine side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_RESTING_PREFIX,
  buildRunSpec,
  parseRestingUntil,
  runJobAndSubmit,
} from "../src/cli/host.mjs";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/cli/host-job-contract.fixture.json"), "utf8"),
);

const stubKit = (run) => ({ run });
const capturingClient = () => {
  const submitted = [];
  return {
    submitted,
    submit: async (id, body) => void submitted.push([id, body]),
  };
};

test("fixture: job carries messages/system/json flag/schema/images; result is {text, usage}", () => {
  assert.equal(typeof fixture.job.model, "string");
  assert.equal(typeof fixture.job.role, "string");
  assert.equal(typeof fixture.job.system, "string");
  assert.ok(Array.isArray(fixture.job.messages) && fixture.job.messages.length > 0);
  const parts = fixture.job.messages.flatMap((m) => m.content);
  assert.ok(parts.some((p) => p.type === "text"));
  assert.ok(parts.some((p) => p.type === "image"));
  assert.equal(fixture.job.json, true);
  assert.ok(fixture.job.schema && typeof fixture.job.schema === "object");
  assert.equal(typeof fixture.result.text, "string");
  assert.ok(fixture.resting.error.startsWith(HOST_RESTING_PREFIX));
});

test("runJobAndSubmit follows the fixture: messages/system/schema reach the kit, images ride along", async () => {
  const seen = [];
  const client = capturingClient();
  const outcome = await runJobAndSubmit({
    kit: stubKit(async (spec) => {
      seen.push(spec);
      return { ok: true, text: fixture.result.text, usage: fixture.result.usage };
    }),
    client,
    job: { id: "job-1", input: fixture.job },
    lane: "chatgpt",
  });
  assert.equal(seen.length, 1);
  const [spec] = seen;
  assert.equal(spec.model, fixture.job.model);
  assert.ok(spec.system.includes(fixture.job.system));
  assert.ok(spec.system.includes(JSON.stringify(fixture.job.schema)));
  assert.deepEqual(spec.meta, { role: fixture.job.role });
  const wantImages = fixture.job.messages.flatMap((m) => m.content).filter((p) => p.type === "image");
  assert.equal(spec.images.length, wantImages.length);
  assert.deepEqual(
    spec.images.map((im) => ({ type: "image", mediaType: im.mimeType, data: im.data })),
    wantImages,
  );
  // The submitted result is {text, usage}, verbatim.
  assert.deepEqual(client.submitted, [["job-1", { result: fixture.result }]]);
  assert.deepEqual(outcome, { result: fixture.result });
});

test("runJobAndSubmit validates JSON for json jobs and types the failures", async () => {
  const client = capturingClient();
  await runJobAndSubmit({
    kit: stubKit(async () => ({ ok: true, text: "not json" })),
    client,
    job: { id: "job-2", input: { ...fixture.job } },
  });
  assert.match(client.submitted[0][1].error, /^invalid-result/);

  await runJobAndSubmit({
    kit: stubKit(async () => ({ ok: true, text: "late" })),
    client,
    job: { id: "job-3", input: {} },
  });
  assert.match(client.submitted[1][1].error, /^invalid-input/);
});

test("resting marker round-trips: fixture error parses to its epoch ms", () => {
  assert.equal(parseRestingUntil(fixture.resting.error), 1788393600000);
  assert.equal(parseRestingUntil("boom"), null);
  assert.equal(parseRestingUntil(undefined), null);
});

test("runJobAndSubmit reports resting as resting_until:<ms>", async () => {
  const client = capturingClient();
  const until = 1788393600000;
  const outcome = await runJobAndSubmit({
    kit: stubKit(async () => ({ ok: false, kind: "resting", until, message: "plan resting" })),
    client,
    job: { id: "job-4", input: fixture.job },
  });
  assert.equal(client.submitted[0][1].error, fixture.resting.error);
  assert.equal(outcome.error, fixture.resting.error);
  assert.equal(outcome.restUntil, until);
  assert.equal(parseRestingUntil(outcome.error), until);
});

test("buildRunSpec still takes legacy single-message jobs", () => {
  const built = buildRunSpec({ id: "legacy", input: { message: "draft a hero", model: "gpt-x" } });
  assert.equal(built.spec.message, "draft a hero");
  assert.equal(built.spec.model, "openai/gpt-x");
  assert.equal(built.wantJson, false);
  assert.equal(built.spec.images, undefined);
  assert.equal(buildRunSpec({ id: "empty", input: {} }), null);
});
