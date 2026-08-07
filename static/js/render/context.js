/* Context usage widget: latest-request window bar, estimated composition,
   breakdown views (model/session/agent/requests) and conversation growth.

   All numbers come from the server payload (/api/context_usage) which reads
   provider-reported token totals - this module never estimates tokens itself.
   The composition panel is a labelled heuristic from the server (estimated). */

import { state, chartRegistry } from "../core/state.js";
import { $, $all, nf, esc, clamp, cssVar, hexToRgba, formatTokens, formatRelative, icons } from "../core/utils.js";

var ctxBound = false;
var selectedSession = null;
var ctxGrowthChart = null;

var CATEGORY_LABELS = {
  system_prompt: "System Prompt",
  tool_definitions: "Tool Definitions",
  rules: "Rules",
  skills: "Skills",
  mcp: "MCP",
  conversation: "Conversation",
  retrieved_context: "Retrieved Context",
  workspace_context: "Workspace Context",
  memory: "Memory",
  runtime_context: "Runtime Context"
};

function humanCat(c) {
  return CATEGORY_LABELS[c] || c;
}

function barWidth(part, total) {
  if (total <= 0) return 0;
  return clamp((part / total) * 100, 0, 100);
}

function segmentHtml(cls, pct) {
  return '<span class="ctxbar__seg ctxbar__seg--' + cls + '" style="width:' + pct.toFixed(2) + '%"></span>';
}

function legendItem(cls, label, value) {
  return '<span class="ctxbar__legend-item"><i class="ctxbar__dot ctxbar__dot--' + cls + '"></i>' + label +
    ' <strong>' + formatTokens(value) + "</strong></span>";
}

function windowCell(limit, used, pct) {
  if (!limit) return '<span class="cell-secondary">-</span>';
  pct = clamp(pct || (used / limit) * 100, 0, 100);
  var cls = pct >= 90 ? "is-danger" : pct >= 75 ? "is-warning" : "";
  return (
    '<span class="ctx">' +
    '<span class="ctx__bar"><span class="ctx__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__num">' + formatTokens(used) + " <em>/ " + formatTokens(limit) + "</em></span>" +
    "</span>"
  );
}

function windowShare(peak, maxPeak) {
  var pct = maxPeak > 0 ? (peak / maxPeak) * 100 : 0;
  return (
    '<span class="ctx" title="Share of the largest peak in this view">' +
    '<span class="ctx__bar"><span class="ctx__fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__num">' + formatTokens(peak) + " <em>" + pct.toFixed(0) + "%</em></span>" +
    "</span>"
  );
}

/* ---------------- Main bar: latest request ---------------- */

function renderLatest(snap) {
  var el = $("#ctxLatest");
  var meta = $("#ctxLatestMeta");
  var empty = $("#ctxLatestEmpty");
  var L = snap.latest;
  if (!L) {
    if (el) el.innerHTML = "";
    if (empty) empty.hidden = false;
    if (meta) meta.textContent = "no requests";
    return;
  }
  if (empty) empty.hidden = true;
  var limit = L.contextLimit || 1;
  var used = L.input + L.cached + L.output + L.reasoning;
  var pct = clamp((used / limit) * 100, 0, 100);
  var segs = segmentHtml("uncached", barWidth(L.input, limit)) +
    segmentHtml("cached", barWidth(L.cached, limit)) +
    segmentHtml("output", barWidth(L.output, limit)) +
    segmentHtml("reasoning", barWidth(L.reasoning, limit));
  var remaining = Math.max(0, limit - used);
  var over = used > limit;

  el.innerHTML =
    '<div class="ctxbar__value">' +
    '<span class="ctxbar__used">' + formatTokens(used) + "</span>" +
    '<span class="ctxbar__sep">/</span>' +
    '<span class="ctxbar__limit">' + formatTokens(limit) + "</span>" +
    '<span class="ctxbar__pct">' + (over ? ">100%" : pct.toFixed(1) + "%") + "</span>" +
    (over ? '<span class="status-badge status-badge--danger">over limit</span>' : "") +
    "</div>" +
    '<div class="ctxbar" role="img" aria-label="Context window utilisation">' + segs +
    '<span class="ctxbar__seg ctxbar__seg--remain" style="width:' + (100 - Math.min(pct, 100)).toFixed(2) + '%"></span>' +
    "</div>" +
    '<div class="ctxbar__legend">' +
    legendItem("uncached", "New input", L.input) +
    legendItem("cached", "Cached", L.cached) +
    legendItem("output", "Output", L.output) +
    legendItem("reasoning", "Reasoning", L.reasoning) +
    '<span class="ctxbar__legend-item"><i class="ctxbar__dot ctxbar__dot--remain"></i>Remaining <strong>' +
    formatTokens(remaining) + "</strong></span>" +
    "</div>";
  if (meta) {
    var peakText = snap.peak && snap.peak.id !== L.id
      ? " · Peak " + formatTokens(snap.peak.total) + " (" + snap.peak.pct + "%)"
      : "";
    meta.textContent = "Latest request · " + esc(L.model.split("/").pop()) + " · " +
      formatRelative(L.time) + peakText;
  }
}

/* ---------------- Composition (estimated) ---------------- */

function renderComposition(snap) {
  var el = $("#ctxComposition");
  var note = $("#ctxCompNote");
  var comp = snap.composition;
  if (!comp || !comp.segments.length) {
    if (el) el.innerHTML = '<span class="cell-secondary">Not available for this request.</span>';
    if (note) note.textContent = "";
    return;
  }
  el.innerHTML = comp.segments.map(function (s) {
    return (
      '<div class="ctx-comp-row">' +
      '<span class="ctx-comp-row__label">' + esc(humanCat(s.category)) + "</span>" +
      '<span class="ctx-comp-row__bar"><span class="ctx-comp-row__fill" style="width:' + clamp(s.pct, 0, 100) + '%"></span></span>' +
      '<span class="ctx-comp-row__num">' + formatTokens(s.tokens) + ' <em>' + s.pct.toFixed(1) + "%</em></span>" +
      '<span class="badge badge--est" title="Estimasi heuristik - opencode.db tidak merekam atribusi token per kategori">Estimasi</span>' +
      "</div>"
    );
  }).join("");
  if (note) note.textContent = comp.note || "";
}

/* ---------------- Breakdown table ---------------- */

function bindCtxControls() {
  if (ctxBound) return;
  ctxBound = true;
  var seg = $("#ctxSegmented");
  if (!seg) return;
  seg.addEventListener("click", function (e) {
    var btn = e.target.closest(".segment-btn");
    if (!btn) return;
    state.contextView = btn.getAttribute("data-ctx-view");
    $all(".segment-btn", seg).forEach(function (b) {
      var on = b === btn;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    selectedSession = null;
    renderBreakdown(state.contextUsage);
  });
  var table = $("#ctxTable");
  if (table) {
    table.addEventListener("click", function (e) {
      var row = e.target.closest("[data-ctx-row]");
      if (!row) return;
      var view = state.contextView;
      if (view === "session") {
        var sid = row.getAttribute("data-session-id");
        selectedSession = sid;
        var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === sid; })[0];
        if (sess) renderContextGrowth(sess);
        $all("#ctxBody tr.is-open").forEach(function (r) {
          if (r !== row) r.classList.remove("is-open");
        });
        row.classList.toggle("is-open");
      } else if (view === "model" || view === "agent") {
        var key = row.getAttribute("data-ctx-key");
        renderContextSubrows(row, key);
      }
    });
  }
}

function renderContextSubrows(row, key) {
  var existing = row.nextElementSibling;
  var open = row.classList.toggle("is-open");
  if (existing && existing.classList.contains("ctx-subrows")) {
    existing.remove();
    return;
  }
  if (!open) return;
  var isModel = state.contextView === "model";
  var list = (state.contextUsage.requests || []).filter(function (r) {
    return isModel ? r.model === key : r.agent === key;
  }).slice(0, 20);
  var tr = document.createElement("tr");
  tr.className = "ctx-subrows";
  tr.innerHTML = '<td colspan="7">' + list.map(function (r) {
    return (
      '<div class="ctx-subrow">' +
      '<span class="mono">' + esc(String(r.id).slice(0, 8)) + "</span>" +
      "<span>" + esc(r.model.split("/").pop()) + "</span>" +
      '<span class="numeric">' + formatTokens(r.input) + "</span>" +
      '<span class="numeric">' + formatTokens(r.cached) + "</span>" +
      '<span class="numeric">' + formatTokens(r.output) + "</span>" +
      '<span class="numeric">' + formatTokens(r.total) + "</span>" +
      '<span class="numeric cell-secondary">' + r.pct.toFixed(1) + "% · " + formatRelative(r.time) + "</span>" +
      "</div>"
    );
  }).join("") || '<span class="cell-secondary">No recent requests for this key.</span>' + "</td>";
  row.insertAdjacentElement("afterend", tr);
}

function renderBreakdown(snap) {
  bindCtxControls();
  var view = state.contextView || "model";
  var body = $("#ctxBody");
  var empty = $("#ctxEmpty");
  if (!body) return;
  var list = [];
  var colCount = 7;

  if (view === "model") {
    list = (snap.byModel || []).map(function (m) {
      return {
        key: m.id,
        name: m.id.split("/").pop(),
        title: m.id,
        requests: m.requests,
        input: m.input,
        cached: m.cached,
        output: m.output,
        peak: m.maxTotal,
        limit: m.contextLimit,
        pct: m.pct,
        sessionId: null
      };
    });
  } else if (view === "session") {
    list = (snap.bySession || []).map(function (s) {
      return {
        key: s.id,
        name: s.title || s.id,
        title: s.title || s.id,
        requests: s.requests,
        input: s.input,
        cached: s.cached,
        output: s.output,
        peak: s.maxTotal,
        limit: null,
        pct: 0,
        sessionId: s.id
      };
    });
  } else if (view === "agent") {
    list = (snap.byAgent || []).map(function (a) {
      return {
        key: a.id,
        name: a.id,
        title: a.id,
        requests: a.requests,
        input: a.input,
        cached: a.cached,
        output: a.output,
        peak: a.maxTotal,
        limit: null,
        pct: 0,
        sessionId: null
      };
    });
  } else {
    list = (snap.requests || []).map(function (r) {
      return {
        key: r.id,
        name: String(r.id).slice(0, 8),
        title: r.id + " · " + r.model,
        requests: 1,
        input: r.input,
        cached: r.cached,
        output: r.output,
        peak: r.total,
        limit: r.contextLimit,
        pct: r.pct,
        sessionId: null,
        time: r.time
      };
    });
  }

  if (empty) empty.hidden = list.length > 0;
  var maxPeak = list.reduce(function (a, r) { return Math.max(a, r.peak || 0); }, 0);
  body.innerHTML = list.slice(0, 50).map(function (r) {
    var chevron = (view === "session" || view === "model" || view === "agent")
      ? '<i data-lucide="chevron-down" class="ctx-chevron"></i>' : "";
    var timeCell = r.time ? '<span class="cell-secondary">' + formatRelative(r.time) + "</span>" : "";
    var sessionRow = view === "session" ? ' data-session-id="' + esc(r.sessionId) + '"' : "";
    var keyRow = (view === "model" || view === "agent") ? ' data-ctx-key="' + esc(r.key) + '"' : "";
    var peakCell = r.limit ? formatTokens(r.peak) : formatTokens(r.peak);
    var windowCellHtml = r.limit
      ? windowCell(r.limit, r.peak, r.pct)
      : windowShare(r.peak, maxPeak);
    return (
      "<tr data-ctx-row" + sessionRow + keyRow + ' class="ctx-row">' +
      "<td>" + chevron + '<span class="cell-primary">' + esc(r.name) + "</span>" +
      '<span class="cell-secondary ctx-row__sub">' + esc(r.title) + "</span>" +
      (timeCell ? '<span class="cell-secondary ctx-row__time">' + timeCell + "</span>" : "") +
      "</td>" +
      '<td class="numeric">' + nf.format(r.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(r.input) + "</td>" +
      '<td class="numeric">' + formatTokens(r.cached) + "</td>" +
      '<td class="numeric">' + formatTokens(r.output) + "</td>" +
      '<td class="numeric">' + peakCell + "</td>" +
      '<td class="numeric">' + windowCellHtml + "</td>" +
      "</tr>"
    );
  }).join("");
  icons();
  if (view === "session" && selectedSession) {
    var sess = (snap.bySession || []).filter(function (s) { return s.id === selectedSession; })[0];
    if (sess) renderContextGrowth(sess);
  }
}

/* ---------------- Conversation growth chart ---------------- */

export function renderContextGrowth(session) {
  var canvas = $("#ctxGrowth");
  var meta = $("#ctxGrowthMeta");
  if (!canvas || !window.Chart) return;
  if (ctxGrowthChart) { ctxGrowthChart.destroy(); ctxGrowthChart = null; }
  var growth = (session.growth || []);
  if (!growth.length) {
    if (meta) meta.textContent = (session.title || session.id) + " · no growth data";
    return;
  }
  if (meta) meta.textContent = (session.title || session.id) + " · " + growth.length + " messages";
  var ctx = canvas.getContext("2d");
  var cachedColor = cssVar("--ctx-cached") || "#7c5cbf";
  var inputColor = cssVar("--chart-input");
  var grad = ctx.createLinearGradient(0, 0, 0, 80);
  grad.addColorStop(0, hexToRgba(inputColor, 0.25));
  grad.addColorStop(1, hexToRgba(inputColor, 0));
  ctxGrowthChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: growth.map(function (_, i) { return "msg " + (i + 1); }),
      datasets: [
        {
          label: "New input",
          data: growth.map(function (g) { return g.input; }),
          borderColor: inputColor,
          backgroundColor: grad,
          fill: true,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.35
        },
        {
          label: "Cached",
          data: growth.map(function (g) { return g.cached; }),
          borderColor: cachedColor,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.35,
          borderDash: [5, 3]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 3, color: cssVar("--text-secondary") } }
      },
      scales: {
        x: { ticks: { color: cssVar("--chart-axis"), maxTicksLimit: 12 }, grid: { display: false } },
        y: { ticks: { color: cssVar("--chart-axis"), callback: function (v) { return formatTokens(v); } }, grid: { color: cssVar("--chart-grid") } }
      }
    }
  });
  chartRegistry.contextGrowth = ctxGrowthChart;
}

export function renderContext(snap) {
  if (!snap) return;
  renderLatest(snap);
  renderComposition(snap);
  renderBreakdown(snap);
}
