import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenMetricsPlugin } from "../plugins/token-metrics.js";

function makeEnv() {
  const dir = mkdtempSync(join(tmpdir(), "tm-plugin-"));
  const state = join(dir, "state.json");
  return { dir, state, env: { ...process.env, TOKENMETRICS_STATE: state } };
}

async function makePlugin(env) {
  const saved = { ...process.env };
  for (const k in env) process.env[k] = env[k];
  const client = { tui: { showToast: () => Promise.resolve() } };
  const plugin = await TokenMetricsPlugin({ client });
  return { plugin, restore: () => { for (const k in saved) process.env[k] = saved[k]; } };
}

const msg = (id, sessionID, total, time) => ({
  id,
  sessionID,
  role: "assistant",
  modelID: "test/model",
  providerID: "test",
  tokens: { input: total, output: 0 },
  total,
  cost: 0,
  time: { completed: time },
});

test("message.updated: same id updates in place, no double count", async () => {
  const e = makeEnv();
  const { plugin, restore } = await makePlugin(e.env);
  try {
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m1", "s1", 100, Date.now()) } } });
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m1", "s1", 100, Date.now()) } } });
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m2", "s1", 50, Date.now()) } } });
    await new Promise((r) => setTimeout(r, 900));
    const out = await plugin.tool.token_metrics.execute({ detail: true });
    const raw = JSON.parse(readFileSync(e.state, "utf8"));
    assert.equal(raw.messages.m1.total, 100);
    assert.equal(raw.messages.m2.total, 50);
    assert.equal(raw.sessions.s1.messageIDs.length, 2);
    assert.match(out, /150 tokens total/);
  } finally {
    restore();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("window: message tokens are attributed to the active window", async () => {
  const e = makeEnv();
  const { plugin, restore } = await makePlugin(e.env);
  try {
    const now = Date.now();
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m1", "s1", 250000, now) } } });
    await new Promise((r) => setTimeout(r, 900));
    const raw = JSON.parse(readFileSync(e.state, "utf8"));
    assert.ok(raw.window);
    assert.ok(raw.window.tokens >= 250000);
    assert.ok(raw.window.start < raw.window.end);
    assert.ok(raw.window.start <= now && now < raw.window.end);
    assert.equal(raw.window.remaining, Math.max(0, raw.window.limit - raw.window.tokens));
  } finally {
    restore();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("session.updated records title and directory", async () => {
  const e = makeEnv();
  const { plugin, restore } = await makePlugin(e.env);
  try {
    await plugin.event({ event: { type: "session.updated", properties: { info: { id: "s1", title: "Audit", directory: "/tmp/x" } } } });
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m1", "s1", 10, Date.now()) } } });
    await new Promise((r) => setTimeout(r, 900));
    const raw = JSON.parse(readFileSync(e.state, "utf8"));
    assert.equal(raw.sessions.s1.title, "Audit");
    assert.equal(raw.sessions.s1.directory, "/tmp/x");
  } finally {
    restore();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("reset: clears state and persists synchronously", async () => {
  const e = makeEnv();
  const { plugin, restore } = await makePlugin(e.env);
  try {
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m1", "s1", 100, Date.now()) } } });
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(readFileSync(e.state, "utf8").includes('"m1"'));
    const out = await plugin.tool.token_metrics.execute({ reset: true });
    assert.match(out, /reset/i);
    const raw = JSON.parse(readFileSync(e.state, "utf8"));
    assert.deepEqual(raw.messages, {});
    assert.deepEqual(raw.sessions, {});
    assert.equal(raw.window, null);
  } finally {
    restore();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("non-assistant or tokenless events are ignored", async () => {
  const e = makeEnv();
  const { plugin, restore } = await makePlugin(e.env);
  try {
    const user = { ...msg("u1", "s1", 100, Date.now()), role: "user" };
    await plugin.event({ event: { type: "message.updated", properties: { info: user } } });
    await plugin.event({ event: { type: "message.updated", properties: { info: { id: "m2", sessionID: "s1", role: "assistant" } } } });
    await plugin.event({ event: { type: "message.updated", properties: { info: msg("m3", "s1", 10, Date.now()) } } });
    await new Promise((r) => setTimeout(r, 900));
    const raw = JSON.parse(readFileSync(e.state, "utf8"));
    assert.deepEqual(Object.keys(raw.messages), ["m3"]);
  } finally {
    restore();
    rmSync(e.dir, { recursive: true, force: true });
  }
});
