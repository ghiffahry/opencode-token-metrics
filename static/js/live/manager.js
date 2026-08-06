/* Realtime engine: live polling, boot/retry, DB banner, toast/status UI. */

import { state, chartRegistry } from "../core/state.js";
import { $, $all, formatTime, cssVar, hexToRgba, nf, formatTokens, clamp } from "../core/utils.js";
import { renderSessionTable, renderPerDay, renderRateLimits } from "../render/tables.js";
import { renderLiveCounters, flashLiveCounters } from "../render/realtime.js";
import {
  apiBase, liveUrl, httpJson, checkHealth, loadLiveRange, refreshLiveRange,
  snapshotSessions, computeSessionDeltas, fetchRealtime
} from "./api.js";
import { renderGraph } from "../render/graph.js";

var liveTimer = null;
var toastTimer = null;
var bootRetryTimer = null;
var lastToastAt = 0;
var graphObserver = null;
var graphBooted = false;

/* ---------------- Live polling ---------------- */
export function liveTick() {
  if (document.hidden) return;
  fetchRealtime()
    .then(function (d) {
      state.liveFailCount = 0;
      state.liveHealthOk = true;
      state.liveRealtime = d;

      var deltas = computeSessionDeltas(d.sessions);
      if (deltas.input > 0 || deltas.output > 0) {
        state.live.input += deltas.input;
        state.live.output += deltas.output;
        pushStream(deltas.input, deltas.output);
      }
      state.liveSessionSnapshot = snapshotSessions(d.sessions);

      renderSessionTable();
      renderLiveCounters();
      flashLiveCounters();

      var rl = state.view && state.view.rateLimits;
      if (rl) {
        rl.rpm.used = d.requestsLastMinute;
        rl.tpm.used = d.tokensLastMinute;
        rl.rpd.used = d.today.requests;
        if (rl.dtp) rl.dtp.used = d.today.tokens;
        renderRateLimits(state.view);
      }
      renderTodayUsage(d.today);

      $("#footerStamp").textContent = "Updated " + formatTime(new Date());
      setLiveStatus(true);

      if (Date.now() - state.liveNextFull > 15000) {
        state.liveNextFull = Date.now();
        refreshLiveRange();
      }
    })
    .catch(function () {
      state.liveFailCount++;
      if (state.liveFailCount >= 3) {
        state.liveHealthOk = false;
        setLiveStatus(false);
      }
    });
}

function renderTodayUsage(today) {
  if (!today) return;
  var req = $("#todayRequests");
  var tok = $("#todayTokens");
  var bar = $("#todayBar");
  var badge = $("#todayBadge");
  if (!req || !tok || !bar) return;
  req.textContent = nf.format(today.requests);
  tok.textContent = formatTokens(today.tokens) + " tokens";
  var rl = state.view.rateLimits;
  var pct = rl && rl.rpd && rl.rpd.limit
    ? clamp((today.requests / rl.rpd.limit) * 100, 0, 100)
    : 0;
  bar.style.width = pct.toFixed(1) + "%";
  bar.className = "progress__bar " + (pct >= 90 ? "is-danger" : pct >= 80 ? "is-warning" : "");
  if (badge) {
    badge.className = "status-badge status-badge--success";
    badge.textContent = "since 00:00";
  }
}

function pushStream(tin, tout) {
  var max = 60;
  state.live.streamLabels.push(formatTime(new Date()));
  state.live.streamIn.push(tin);
  state.live.streamOut.push(tout);
  if (state.live.streamLabels.length > max) {
    state.live.streamLabels.shift();
    state.live.streamIn.shift();
    state.live.streamOut.shift();
  }
  if (chartRegistry.realtime) {
    chartRegistry.realtime.data.labels = state.live.streamLabels.slice();
    chartRegistry.realtime.data.datasets[0].data = state.live.streamIn.slice();
    chartRegistry.realtime.data.datasets[1].data = state.live.streamOut.slice();
    chartRegistry.realtime.update("none");
  }
}

/* ---------------- Boot / retry ---------------- */
/* Render the knowledge graph only once the #graph section scrolls into view,
   so vis-network physics never blocks first paint or the boot sequence. */
function ensureGraphLoaded() {
  if (graphBooted) return;
  var sec = $("#graph");
  if (!sec || !("IntersectionObserver" in window)) {
    graphBooted = true;
    renderGraph();
    return;
  }
  graphObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        graphBooted = true;
        if (graphObserver) graphObserver.disconnect();
        renderGraph();
      }
    });
  }, { rootMargin: "400px" });
  graphObserver.observe(sec);
}

function setDbBanner(info) {
  var b = $("#dbBanner");
  if (!b) return;
  if (info && !info.dbExists) {
    var path = info.db || "";
    $("#dbBannerText").textContent =
      "Database OpenCode tidak ditemukan: " + path + " — usage tidak tersedia, bukan data fiktif. Jalankan OpenCode atau atur --db ke file SQLite yang benar.";
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

function renderDataInsight(info) {
  var source = $("#dataSourceValue");
  var meta = $("#dataSourceMeta");
  if (source) source.textContent = info && info.dbReadable ? "OpenCode SQLite" : "Unavailable";
  if (meta) meta.textContent = info && info.dbReadable ? "Actual local usage data" : "No usage is being invented";
}

function renderQuotaInsight(view) {
  var quota = $("#dailyQuotaValue");
  var meta = $("#dailyQuotaMeta");
  var daily = view && view.rateLimits && view.rateLimits.dtp;
  if (!quota || !daily) return;
  if (Number.isFinite(daily.limit)) {
    quota.textContent = formatTokens(daily.limit) + " tokens";
    if (daily.source === "configured") meta.textContent = "Configured limit (TOKENMETRICS_DTP)";
    else if (daily.source === "default") meta.textContent = "Default estimate - set TOKENMETRICS_DTP to override";
    else meta.textContent = "Server-provided limit";
  } else {
    quota.textContent = "Unknown";
    meta.textContent = "Provider quota not exposed - set TOKENMETRICS_DTP to define";
  }
}

export function startLive() {
  state.liveMode = true;
  setLiveStatus("connecting");
  clearInterval(liveTimer);
  liveTimer = setInterval(liveTick, 4000);
  bootLive();
}

function bootLive() {
  checkHealth()
    .then(function (h) {
      setDbBanner(h);
      renderDataInsight(h);
      state.dbExists = !!h.dbExists;
      state.liveHealthOk = !!(h && h.ok && h.dbReadable);
      if (h && h.ok && h.dbReadable) {
        setLiveStatus(true);
      }
      return httpJson(liveUrl("/api/context"));
    })
    .then(function (c) {
      state.liveContext = (c && c.models) || {};
      state.liveDefaultContext = (c && c.default) || 200000;
      return loadLiveRange(state.range);
    })
    .then(function () {
      state.liveNextFull = Date.now();
      return fetchRealtime();
    })
    .then(function (d) {
      state.liveRealtime = d;
      state.liveSessionSnapshot = snapshotSessions(d.sessions);
      renderSessionTable();
      renderLiveCounters();
      renderQuotaInsight(state.view);
      $("#lastUpdateValue").textContent = formatTime(new Date());
      ensureGraphLoaded();
      setLiveStatus(true);
      showToast(
        state.dbExists
          ? "Live: reading opencode database (" + apiBase() + ")"
          : "DB OpenCode tidak tersedia — usage belum dapat dibaca",
        state.dbExists ? "success" : "error"
      );
    })
    .catch(function (err) {
      // Server unreachable or boot failed. Keep status online if the health
      // check already succeeded this cycle, otherwise drop to offline.
      if (state.liveHealthOk) {
        scheduleBoot(3000);
        return;
      }
      setLiveStatus(false);
      var now = Date.now();
      if (now - lastToastAt > 20000) {
        lastToastAt = now;
        showToast("Live server unreachable (" + apiBase() + ") — retrying…", "error");
      }
      scheduleBoot(2000);
    });
}

function scheduleBoot(ms) {
  clearTimeout(bootRetryTimer);
  bootRetryTimer = setTimeout(bootLive, ms);
}

/* ---------------- Status / toast ---------------- */
function setLiveStatus(ok) {
  var pill = $("#connectionPill");
  var text = $(".connection-pill__text", pill);
  var online = ok === true;
  var connecting = ok === "connecting";
  pill.classList.toggle("is-offline", !online && !connecting);
  pill.classList.toggle("is-connecting", connecting);
  text.textContent = connecting ? "Connecting…" : (online ? "Live DB" : "Offline");
  $("#statusTitle").textContent = connecting ? "Connecting to opencode" : (online ? "Connected to opencode" : "Server offline");
  $("#statusMeta").textContent = connecting ? "detecting local server…" : (online ? "reading local opencode.db" : "retrying…");
  $("#systemStatus").classList.toggle("is-degraded", !online && !connecting);
}

function showToast(msg, type) {
  var el = $("#toast");
  el.textContent = msg;
  el.className = "toast toast--" + (type || "success");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 4000);
}

export function refreshLiveChartTheme() {
  Object.keys(chartRegistry.sparks || {}).forEach(function (k) {
    var c = chartRegistry.sparks[k];
    if (!c || !c.data || !c.data.datasets) return;
    c.data.datasets.forEach(function (ds) {
      ds.borderColor = cssVar("--chart-input");
      var base = cssVar("--chart-input");
      var ctx = c.ctx;
      if (ctx) {
        var grad = ctx.createLinearGradient(0, 0, 0, 42);
        grad.addColorStop(0, hexToRgba(base, 0.28));
        grad.addColorStop(1, hexToRgba(base, 0));
        ds.backgroundColor = grad;
      }
    });
    c.update();
  });
  Object.keys(chartRegistry).forEach(function (k) {
    var c = chartRegistry[k];
    if (!c || typeof c.update !== "function") return;
    var data = c.data;
    if (data && data.datasets) {
      data.datasets.forEach(function (ds) {
        if (k === "generation") { ds.borderColor = cssVar("--chart-input-border"); ds.backgroundColor = cssVar("--chart-input"); }
        else if (k === "api") { ds.borderColor = cssVar("--chart-output-border"); ds.backgroundColor = cssVar("--chart-output"); }
        else if (k === "usage" || k === "realtime") {
          if (ds.label === "Input") { ds.borderColor = cssVar("--chart-input"); ds.backgroundColor = cssVar("--chart-input"); }
          else { ds.borderColor = cssVar("--chart-output"); ds.backgroundColor = cssVar("--chart-output"); }
        }
      });
    }
    c.update();
  });
  Chart.defaults.color = cssVar("--text-secondary");
  Chart.defaults.borderColor = cssVar("--border");
}
