/* Export menu handlers: CSV, JSON and PNG snapshot of the current view. */

import { state } from "../core/state.js";
import { downloadBlob, formatTokens } from "../core/utils.js";
import { getFilteredRequests } from "../render/tables.js";
import { rangeTitle } from "../live/api.js";

export function exportCSV() {
  var view = state.view;
  var lines = [];
  lines.push("Section,Model/Date,Requests,Input,Output,Total,Errors,SuccessRate,Latency");
  view.models.forEach(function (m) {
    var rate = ((m.requests - m.errors) / m.requests * 100).toFixed(2);
    lines.push(["Model", m.name, m.requests, m.input, m.output, m.input + m.output, m.errors, rate + "%", m.latency].join(","));
  });
  lines.push("");
  lines.push("Section,Date,Requests,Input,Output,Total");
  view.tableRows.forEach(function (r) {
    lines.push(["Day", r.label, r.requests, r.input, r.output, r.input + r.output].join(","));
  });
  lines.push("");
  lines.push("Section,Request,Model,Agent,Input,Output,Total,Latency,Status,Time");
  getFilteredRequests().forEach(function (r) {
    lines.push(["Request", r.id, r.model, r.agent, r.input, r.output, r.total, r.latency, r.status, r.time.toISOString()].join(","));
  });

  downloadBlob(lines.join("\n"), "token-metrics-" + state.range + ".csv", "text/csv;charset=utf-8");
}

export function exportJSON() {
  var payload = {
    exported: new Date().toISOString(),
    range: state.range,
    project: state.project,
    filters: { model: state.modelFilter, agent: state.agentFilter, search: state.requestSearch },
    view: state.view,
    contextUsage: state.contextUsage,
    budget: state.budget,
    realtime: state.liveRealtime,
    requests: getFilteredRequests().slice(0, 200)
  };
  downloadBlob(
    JSON.stringify(payload, function (k, v) {
      if (v instanceof Date) return v.toISOString();
      return v;
    }, 2),
    "token-metrics-" + state.range + ".json",
    "application/json"
  );
}

export function exportPNG() {
  var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas"))
    .filter(function (c) { return c.width > 0 && c.height > 0; });
  if (!canvases.length) return;

  var pad = 16;
  var headerH = 48;
  var totalH = headerH + canvases.reduce(function (a, c) { return a + c.height + pad; }, 0);
  var maxW = Math.max.apply(null, canvases.map(function (c) { return c.width; }));

  var out = document.createElement("canvas");
  out.width = maxW + pad * 2;
  out.height = totalH;
  var ctx = out.getContext("2d");
  ctx.fillStyle = "#1c1f22";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "#e8eaed";
  ctx.font = "600 20px Inter, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Token Metrics · " + rangeTitle(state.project, state.view), pad, headerH / 2);

  var y = headerH;
  canvases.forEach(function (c) {
    ctx.drawImage(c, Math.floor((out.width - c.width) / 2), y);
    y += c.height + pad;
  });

  out.toBlob(function (blob) {
    if (blob) downloadBlob(blob, "token-metrics-" + state.range + ".png", "image/png");
  }, "image/png");
}

export function exportSummary() {
  return {
    period: state.view ? state.view.rangeLabel : "…",
    filters: (state.modelFilter === "all" ? "all models" : state.modelFilter.split("/").pop()) +
      " · " + (state.agentFilter === "all" ? "all agents" : state.agentFilter),
    tokens: state.view ? formatTokens(state.view.total) : "…",
    requests: state.view ? String(state.view.requests) : "…"
  };
}
