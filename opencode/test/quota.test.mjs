import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaConfig, windowBounds, sumTokens, statusFor, fmtCompact } from "../plugins/quota.js";

const CFG = { limit: 2_500_000, hours: 14, anchorHour: 4 };

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

test("windowBounds: 04:00 anchor boundary starts a fresh window", () => {
  const w = windowBounds(at(2026, 8, 10, 4, 0), CFG);
  assert.equal(w.start, at(2026, 8, 10, 4, 0));
  assert.equal(w.end, at(2026, 8, 10, 18, 0));
});

test("windowBounds: before 18:00 stays in 04:00-18:00", () => {
  const w = windowBounds(at(2026, 8, 10, 10, 0), CFG);
  assert.equal(w.start, at(2026, 8, 10, 4, 0));
  assert.equal(w.end, at(2026, 8, 10, 18, 0));
  const w2 = windowBounds(at(2026, 8, 10, 17, 59), CFG);
  assert.equal(w2.start, at(2026, 8, 10, 4, 0));
});

test("windowBounds: exactly 18:00 rolls into the next window", () => {
  const w = windowBounds(at(2026, 8, 10, 18, 0), CFG);
  assert.equal(w.start, at(2026, 8, 10, 18, 0));
  assert.equal(w.end, at(2026, 8, 11, 8, 0));
});

test("windowBounds: after 18:00 selects the active (next) window, not the past one", () => {
  const w = windowBounds(at(2026, 8, 10, 20, 0), CFG);
  assert.equal(w.start, at(2026, 8, 10, 18, 0));
  assert.equal(w.end, at(2026, 8, 11, 8, 0));
  assert.ok(w.start <= at(2026, 8, 10, 20, 0) && at(2026, 8, 10, 20, 0) < w.end);
});

test("windowBounds: before the anchor belongs to the previous cycle", () => {
  const w = windowBounds(at(2026, 8, 10, 2, 0), CFG);
  assert.equal(w.end, at(2026, 8, 10, 4, 0));
  assert.equal(w.start, at(2026, 8, 9, 14, 0));
});

test("windowBounds: short windows advance multiple times (hours=4, anchor=0)", () => {
  const cfg = { ...CFG, hours: 4, anchorHour: 0 };
  const w = windowBounds(at(2026, 8, 10, 10, 0), cfg);
  assert.equal(w.start, at(2026, 8, 10, 8, 0));
  assert.equal(w.end, at(2026, 8, 10, 12, 0));
});

test("windowBounds: now is always inside the returned window (property sweep)", () => {
  for (let d = 1; d <= 28; d++) {
    for (let h = 0; h < 24; h += 3) {
      for (const cfg of [CFG, { ...CFG, hours: 4, anchorHour: 0 }, { ...CFG, hours: 8, anchorHour: 21 }]) {
        const now = at(2026, 8, d, h);
        const w = windowBounds(now, cfg);
        assert.ok(w.start < w.end, `start<end ${new Date(w.start).toISOString()}`);
        assert.ok(w.start <= now && now < w.end, `now ${new Date(now).toISOString()} outside [${new Date(w.start).toISOString()}, ${new Date(w.end).toISOString()}] cfg=${JSON.stringify(cfg)}`);
        assert.equal((w.end - w.start) / 3600_000, cfg.hours);
      }
    }
  }
});

test("quotaConfig: defaults and env overrides", () => {
  const d = quotaConfig({});
  assert.deepEqual({ limit: d.limit, hours: d.hours, anchorHour: d.anchorHour }, { limit: 2_500_000, hours: 14, anchorHour: 4 });
  assert.equal(d.source, "default");
  const c = quotaConfig({ TOKENMETRICS_QUOTA_TOKENS: "1000", TOKENMETRICS_QUOTA_WINDOW_HOURS: "6", TOKENMETRICS_QUOTA_ANCHOR_HOUR: "2" });
  assert.equal(c.limit, 1000);
  assert.equal(c.hours, 6);
  assert.equal(c.anchorHour, 2);
  assert.equal(c.source, "configured");
  const bad = quotaConfig({ TOKENMETRICS_QUOTA_TOKENS: "nope" });
  assert.equal(bad.limit, 2_500_000);
});

test("sumTokens: adds input/output/reasoning/cache", () => {
  assert.equal(sumTokens(null), 0);
  assert.equal(sumTokens({}), 0);
  assert.equal(sumTokens({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } }), 15);
});

test("statusFor: tier mapping", () => {
  assert.equal(statusFor(0, false), "healthy");
  assert.equal(statusFor(60, false), "watch");
  assert.equal(statusFor(80, false), "high");
  assert.equal(statusFor(95, false), "critical");
  assert.equal(statusFor(30, true), "exhaustion");
});

test("fmtCompact: k/M formatting", () => {
  assert.equal(fmtCompact(999), "999");
  assert.equal(fmtCompact(1500), "2K");
  assert.equal(fmtCompact(2500000), "2.5M");
});
