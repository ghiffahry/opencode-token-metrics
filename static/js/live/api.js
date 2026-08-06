/* Live backend access: HTTP helpers, project list/filter, view assembly, polling. */

import { state, liveRangeCache } from "../core/state.js";
import { $, esc } from "../core/utils.js";
import { weeklyGroup } from "../data/derive.js";
import { renderKpis, renderSparks } from "../render/kpis.js";
import { renderEfficiency } from "../render/efficiency.js";
import { renderBarCharts, renderUsageChart, renderStagesChart } from "../render/charts.js";
import { renderModelTable, renderRequests, renderPerDay, renderSessionTable, renderRateLimits } from "../render/tables.js";
import { renderLiveCounters } from "../render/realtime.js";

var LIVE_PORT = 8124;

export function apiBase() {
  if (/^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    return location.origin;
  }
  return "http://127.0.0.1:" + LIVE_PORT;
}

export function liveUrl(path) {
  return apiBase() + path;
}

export function httpJson(url, timeout) {
  return new Promise(function (resolve, reject) {
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var t = setTimeout(function () {
      if (ctrl) ctrl.abort();
      reject(new Error("timeout"));
    }, timeout || 8000);
    var opts = ctrl ? { signal: ctrl.signal } : {};
    fetch(url, opts)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { clearTimeout(t); resolve(d); })
      .catch(function (e) { clearTimeout(t); reject(e); });
  });
}

export function checkHealth() {
  return httpJson(liveUrl("/api/health"), 6000);
}

function scopeQuery() {
  var parts = [];
  if (state.project && state.project !== "(unknown)") parts.push("project=" + encodeURIComponent(state.project));
  if (state.modelFilter && state.modelFilter !== "all") parts.push("model=" + encodeURIComponent(state.modelFilter));
  return parts.join("&");
}

function apiUrl(path) {
  var q = scopeQuery();
  if (!q) return liveUrl(path);
  return liveUrl(path + (path.indexOf("?") >= 0 ? "&" : "?") + q);
}

export function projectLabel(d) {
  var parts = String(d).split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) return d;
  return parts[parts.length - 2] + "/" + parts[parts.length - 1];
}

export function loadProjects() {
  return httpJson(liveUrl("/api/projects"), 6000)
    .then(function (d) {
      state.projects = d.projects || [];
      var sel = $("#projectSelect");
      var html = '<option value="(unknown)">All projects</option>' + state.projects.map(function (p) {
        return '<option value="' + esc(p.directory) + '">' + esc(projectLabel(p.directory)) + "</option>";
      }).join("");
      sel.innerHTML = html;
      var saved = null;
      try { saved = localStorage.getItem("project"); } catch (e) {}
      var valid = saved && state.projects.some(function (p) { return p.directory === saved; });
      state.project = valid ? saved : "(unknown)";
      sel.value = state.project;
      sel.disabled = state.projects.length === 0;
      return d;
    })
    .catch(function () {
      state.projects = [];
      state.project = "(unknown)";
      var sel = $("#projectSelect");
      sel.innerHTML = '<option value="(unknown)">All projects</option>';
      sel.disabled = true;
    });
}

export function liveContextLimit(id) {
  var short = String(id).split("/").pop();
  return state.liveContext[id] || state.liveContext[short] || state.liveDefaultContext || 200000;
}

function liveViewFrom(o, m) {
  var buckets = o.buckets || [];
  var chartBuckets = o.range === "90d" ? weeklyGroup(buckets) : buckets;
  var requestsList = state.liveRequests.map(function (r) {
    return {
      id: r.id,
      modelId: r.model,
      model: r.model,
      agent: r.agent,
      input: r.input,
      output: r.output,
      total: r.total,
      latency: r.latency,
      status: r.status,
      time: new Date(r.time)
    };
  });
  return {
    source: "live",
    range: o.range,
    rangeLabel: o.rangeLabel,
    models: (m.models || []).map(function (x) {
      return {
        id: x.id,
        name: x.name,
        short: x.short,
        requests: x.requests,
        input: x.input,
        output: x.output,
        errors: x.errors,
        success: x.success,
        latency: x.latency,
        status: x.status,
        contextLimit: x.contextLimit || liveContextLimit(x.id),
        contextUsed: x.contextUsed
      };
    }),
    stages: o.stages || [],
    buckets: buckets,
    chartBuckets: chartBuckets,
    tableRows: o.tableRows || [],
    requests: o.requests,
    success: o.success,
    errors: o.errors,
    input: o.input,
    output: o.output,
    total: o.total,
    successRate: o.successRate,
    latency: o.latency,
    avgIn: o.avgIn,
    avgOut: o.avgOut,
    ratio: o.ratio,
    rateLimits: o.rateLimits,
    prev: o.prev || {},
    requestsList: requestsList,
    notes: o.notes
  };
}

function renderLiveAll(view) {
  renderKpis(view);
  renderEfficiency(view);
  renderBarCharts(view);
  renderUsageChart(view);
  renderStagesChart(view);
  renderModelTable(view);
  renderRequests();
  renderPerDay(view);
  $("#overviewSub").textContent = projectLabel(state.project) + " · " + view.rangeLabel;
  $("#modelsSub").textContent = "Aggregated · " + view.rangeLabel;
  $("#limitsSub").textContent = "Live quota utilisation";
}

export function loadLiveRange(rangeKey) {
  var cacheKey = [rangeKey, state.project || "", state.modelFilter || "all"].join("|");
  var cached = liveRangeCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 15000) {
    applyLiveRange(cached.data);
    return Promise.resolve(cached.data[0]);
  }
  var requestSequence = ++state.liveLoadSequence;
  return Promise.all([
    httpJson(apiUrl("/api/overview?range=" + rangeKey), 60000),
    httpJson(apiUrl("/api/models?range=" + rangeKey), 60000),
    httpJson(apiUrl("/api/requests?limit=60"), 30000)
  ]).then(function (res) {
    if (requestSequence !== state.liveLoadSequence) return res[0];
    liveRangeCache.set(cacheKey, { time: Date.now(), data: res });
    applyLiveRange(res);
    return res[0];
  });
}

function applyLiveRange(res) {
    state.liveRequests = (res[2].requests || []).map(function (r) {
      r.time = Number(r.time);
      return r;
    });
    state.view = liveViewFrom(res[0], res[1]);
    state.sort = { key: "total", dir: "desc" };
    state.page = 1;
    state.live = { input: 0, output: 0, streamIn: [], streamOut: [], streamLabels: [] };
    state.liveSessionSnapshot = {};
    populateFilters(state.view);
    renderLiveAll(state.view);
    renderSessionTable();
    renderRateLimits(state.view);
    renderLiveCounters();
}

export function refreshLiveRange() {
  return Promise.all([
    httpJson(apiUrl("/api/overview?range=" + state.range), 60000),
    httpJson(apiUrl("/api/models?range=" + state.range), 60000)
  ]).then(function (res) {
    state.view = liveViewFrom(res[0], res[1]);
    renderKpis(state.view);
    renderEfficiency(state.view);
    renderBarCharts(state.view);
    renderUsageChart(state.view);
    renderStagesChart(state.view);
    renderModelTable(state.view);
    renderRequests();
    renderPerDay(state.view);
  }).catch(function () {});
}

export function populateFilters(view) {
  var modelSel = $("#modelFilter");
  var agentSel = $("#agentFilter");
  var curModel = state.modelFilter;
  var curAgent = state.agentFilter;
  modelSel.innerHTML = '<option value="all">All models</option>' +
    view.models.map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.name) + "</option>";
    }).join("");
  agentSel.innerHTML = '<option value="all">All agents</option>' +
    view.stages.map(function (s) {
      return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>";
    }).join("");
  state.modelFilter = curModel !== "all" && view.models.some(function (m) { return m.id === curModel; })
    ? curModel : "all";
  state.agentFilter = curAgent !== "all" && view.stages.some(function (s) { return s.name === curAgent; })
    ? curAgent : "all";
  modelSel.value = state.modelFilter;
  agentSel.value = state.agentFilter;
}

export function snapshotSessions(list) {
  var snap = {};
  (list || []).forEach(function (s) { snap[s.id] = { input: s.input, output: s.output }; });
  return snap;
}

export function computeSessionDeltas(list) {
  var tin = 0, tout = 0;
  (list || []).forEach(function (s) {
    var prev = state.liveSessionSnapshot[s.id];
    if (prev) {
      tin += Math.max(0, s.input - prev.input);
      tout += Math.max(0, s.output - prev.output);
    }
  });
  return { input: tin, output: tout };
}

export function fetchRealtime() {
  return httpJson(apiUrl("/api/realtime"), 6000);
}
