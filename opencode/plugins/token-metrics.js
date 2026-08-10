// opencode-token-metrics - realtime token usage + quota monitor.
//
// Captures assistant-message token usage from opencode events and persists a
// small state.json (default ~/.local/share/token-metrics/state.json) with a
// per-session breakdown and an estimated quota-window summary. The numbers
// match the dashboard conventions: quota window of N hours anchored at a
// local hour, 2.5M default tokens. Like the dashboard, the reset timing is an
// ESTIMATE, never exact provider timing.
//
// Dependency-light on purpose: only node builtins + the plugin `tool` helper.
// All hooks are try/catch wrapped so this plugin can never break opencode.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { tool } from "@opencode-ai/plugin";
import { quotaConfig, windowBounds, sumTokens, statusFor, fmtNum, fmtCompact, fmtDuration } from "./quota.js";

const MAX_MESSAGES = 5000;
const PERSIST_DEBOUNCE_MS = 750;
const DEFAULT_RETENTION_DAYS = 30;

function retentionMs(env = process.env) {
  const n = Number(env.TOKENMETRICS_RETENTION_DAYS);
  const days = Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
  return days * 86_400_000;
}

function statePath() {
  if (process.env.TOKENMETRICS_STATE) return process.env.TOKENMETRICS_STATE;
  return join(homedir(), ".local", "share", "token-metrics", "state.json");
}

function emptyState() {
  return {
    version: 1,
    generated: null,
    config: quotaConfig(),
    sessions: {},
    messages: {},
    window: null,
    notified: {},
  };
}

function loadState(p) {
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return { ...emptyState(), ...raw };
  } catch {
    return emptyState();
  }
}

const TOAST_TIERS = [
  { at: 90, label: "Token quota CRITICAL", variant: "warning" },
  { at: 75, label: "Token quota HIGH", variant: "warning" },
  { at: 50, label: "Token quota at 50%", variant: "info" },
];

export const TokenMetricsPlugin = async ({ client }) => {
  const path = statePath();
  const state = loadState(path);
  let persistTimer = null;

  const persistNow = () => {
    state.generated = new Date().toISOString();
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = path + ".tmp";
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, path);
    } catch {
      // never let persistence break the host
    }
  };

  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  };

  function recomputeSession(sessionID) {
    const s = state.sessions[sessionID];
    if (!s) return;
    let input = 0, output = 0, reasoning = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    for (const mid of s.messageIDs) {
      const m = state.messages[mid];
      if (!m) continue;
      input += m.tokens?.input || 0;
      output += m.tokens?.output || 0;
      reasoning += m.tokens?.reasoning || 0;
      cacheRead += m.tokens?.cache?.read || 0;
      cacheWrite += m.tokens?.cache?.write || 0;
      cost += m.cost || 0;
    }
    s.tokens = {
      input, output, reasoning, cacheRead, cacheWrite,
      total: input + output + reasoning + cacheRead + cacheWrite,
    };
    s.cost = cost;
    s.messages = s.messageIDs.length;
  }

  function pruneMessages() {
    const ids = Object.keys(state.messages);
    if (ids.length <= MAX_MESSAGES) return;
    ids.sort((a, b) => (state.messages[a].time || 0) - (state.messages[b].time || 0));
    while (Object.keys(state.messages).length > MAX_MESSAGES) {
      const oldest = ids.shift();
      const m = state.messages[oldest];
      if (!m) continue;
      delete state.messages[oldest];
      const s = state.sessions[m.sessionID];
      if (s) {
        const i = s.messageIDs.indexOf(oldest);
        if (i >= 0) s.messageIDs.splice(i, 1);
      }
    }
  }

  // Retention: drop sessions that hold no messages and have not been
  // touched within the retention window. Message bodies are already capped
  // by pruneMessages; this stops session metadata from growing forever.
  function pruneSessions(now) {
    const cutoff = now - retentionMs();
    for (const id in state.sessions) {
      const s = state.sessions[id];
      if (s.messageIDs.length > 0) continue;
      if (!s.updated || s.updated >= cutoff) continue;
      delete state.sessions[id];
    }
  }

  function recomputeWindow(now) {
    const cfg = quotaConfig();
    const { start, end } = windowBounds(now, cfg);
    let tokens = 0, requests = 0;
    for (const id in state.messages) {
      const m = state.messages[id];
      if (m.time >= start && m.time < end) {
        tokens += m.total;
        requests += 1;
      }
    }
    const remaining = Math.max(0, cfg.limit - tokens);
    const pct = cfg.limit > 0 ? (tokens / cfg.limit) * 100 : 0;
    const elapsedHours = Math.max(0, (now - start) / 3600_000);
    const burnRate = elapsedHours > 0 ? tokens / elapsedHours : 0;
    const hoursLeft = (end - now) / 3600_000;
    const projectedAtReset = burnRate > 0 ? tokens + burnRate * hoursLeft : 0;
    const willExhaust = projectedAtReset >= cfg.limit;
    state.window = {
      start, end,
      anchorHour: cfg.anchorHour,
      hours: cfg.hours,
      limit: cfg.limit,
      source: cfg.source,
      tokens,
      requests,
      remaining,
      pct,
      burnRatePerHour: burnRate,
      projectedAtReset,
      willExhaustBeforeReset: willExhaust,
      status: statusFor(pct, willExhaust),
    };
    return state.window;
  }

  function maybeToast(win) {
    for (const tier of TOAST_TIERS) {
      if (win.pct >= tier.at && !state.notified[tier.at]) {
        state.notified[tier.at] = Date.now();
        client?.tui?.showToast({
          body: {
            message: `${tier.label}: ${fmtCompact(win.tokens)} / ${fmtCompact(win.limit)} tokens used (${win.pct.toFixed(0)}%)`,
            variant: tier.variant,
          },
        }).catch(() => {});
      }
    }
  }

  function onMessage(info) {
    if (info.role !== "assistant" || !info.tokens) return;
    const total = sumTokens(info.tokens);
    if (!total && !info.cost) return;
    const ts = info.time?.completed ?? info.time?.created;
    const prev = state.messages[info.id];
    state.messages[info.id] = {
      sessionID: info.sessionID,
      model: info.modelID,
      provider: info.providerID,
      tokens: info.tokens,
      total,
      cost: info.cost || 0,
      time: ts ?? Date.now(),
    };
    const s = state.sessions[info.sessionID] ||= { messageIDs: [] };
    s.updated = ts ?? Date.now();
    if (info.modelID) s.model = info.modelID;
    if (prev === undefined) s.messageIDs.push(info.id);
    recomputeSession(info.sessionID);
    pruneMessages();
    pruneSessions(Date.now());
    const win = recomputeWindow(Date.now());
    maybeToast(win);
    persist();
  }

  function onSession(info) {
    if (!info?.id) return;
    const s = state.sessions[info.id] ||= { messageIDs: [] };
    if (info.title) s.title = info.title;
    if (info.directory) s.directory = info.directory;
    persist();
  }

  function summary(detail) {
    const win = state.window;
    const lines = ["Token Metrics (live)"];
    if (win) {
      const pct = win.pct.toFixed(0) + "%";
      lines.push(`Window: ${fmtCompact(win.tokens)} / ${fmtCompact(win.limit)} tokens (${pct}) - ${win.status}`);
      lines.push(`Reset in ~${fmtDuration(win.end - Date.now())}; burn ${fmtCompact(win.burnRatePerHour)}/h, projected ${fmtCompact(win.projectedAtReset)} at reset`);
      lines.push(`Requests in window: ${fmtNum(win.requests)}`);
    } else {
      lines.push("No usage captured yet (plugin just started).");
    }
    const active = Object.values(state.sessions).filter((s) => s.messages > 0).length;
    const total = Object.values(state.sessions).reduce((a, s) => a + (s.tokens?.total || 0), 0);
    lines.push(`Active sessions: ${fmtNum(active)} - ${fmtCompact(total)} tokens total`);
    if (detail) {
      const top = Object.values(state.sessions)
        .filter((s) => s.messages > 0)
        .sort((a, b) => (b.tokens?.total || 0) - (a.tokens?.total || 0))
        .slice(0, 5)
        .map((s) => `- ${s.title || s.directory || "(untitled)"}: ${fmtCompact(s.tokens?.total || 0)}`)
        .join("\n");
      if (top) lines.push(top);
      lines.push(`State file: ${path}`);
    }
    return lines.join("\n");
  }

  return {
    event: async ({ event }) => {
      try {
        if (event.type === "message.updated") {
          onMessage(event.properties?.info);
        } else if (event.type === "session.updated") {
          onSession(event.properties?.info);
        }
      } catch {
        // ignore - never break the host
      }
    },
    tool: {
      token_metrics: tool({
        description:
          "Return live token usage and estimated quota-window status captured from opencode events. " +
          "Short text summary by default; pass detail=true for per-session breakdown and the state file path. " +
          "Pass reset=true to clear captured state and start over (retention is otherwise automatic).",
        args: {
          detail: tool.schema.boolean().optional(),
          reset: tool.schema.boolean().optional(),
        },
        async execute(args) {
          if (args?.reset) {
            state.sessions = {};
            state.messages = {};
            state.window = null;
            state.notified = {};
            persistNow();
            return "Token Metrics state reset. Monitoring continues from now.";
          }
          return summary(!!args?.detail);
        },
      }),
    },
  };
};
