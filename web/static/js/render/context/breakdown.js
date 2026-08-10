/* Context breakdown table with model / session / agent / requests views. */

import { state } from "../../core/state.js";
import { $, $all, nf, esc, clamp, formatTokens, formatRelative, icons } from "../../core/utils.js";
import { refreshTooltips } from "../../ui/tooltip.js";
import { ctxState } from "./state.js";
import { bindCompositionControls } from "./composition.js";
import { showGrowthEmpty, renderContextGrowth } from "./growth.js";
import { openContextDrawer } from "./drawer.js";

function windowCell(limit, used, pct) {
  if (!limit) return '<span class="cell-secondary">-</span>';
  pct = clamp(pct || (used / limit) * 100, 0, 100);
  var cls = pct > 90 ? "is-danger" : pct >= 75 ? "is-warning" : "";
  return (
    '<span class="ctx" data-tip="' + nf.format(used) + " of " + nf.format(limit) +
    " tokens (" + pct.toFixed(1) + "% of window)\">" +
    '<span class="ctx__bar"><span class="ctx__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__pct ' + (cls === "is-danger" ? "is-danger-text" : cls === "is-warning" ? "text-warn" : "") + '">' +
    pct.toFixed(1) + "%</span>" +
    "</span>"
  );
}

function windowShare(peak, maxPeak) {
  var pct = maxPeak > 0 ? (peak / maxPeak) * 100 : 0;
  return (
    '<span class="ctx" data-tip="' + nf.format(peak) + " tokens · Share of the largest peak in this view\">" +
    '<span class="ctx__bar"><span class="ctx__fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__pct">' + pct.toFixed(0) + "%</span>" +
    "</span>"
  );
}

function bindCtxControls() {
  if (ctxState.bound) return;
  ctxState.bound = true;
  var seg = $("#ctxSegmented");
  if (seg) {
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest(".segment-btn");
      if (!btn) return;
      state.contextView = btn.getAttribute("data-ctx-view");
      $all(".segment-btn", seg).forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      ctxState.selectedSession = null;
      showGrowthEmpty();
      renderBreakdown(state.contextUsage);
    });
  }
  var table = $("#ctxTable");
  if (table) {
    table.addEventListener("click", function (e) {
      var row = e.target.closest("[data-ctx-row]");
      if (!row) return;
      var view = state.contextView;
      if (view === "session") {
        var sid = row.getAttribute("data-session-id");
        ctxState.selectedSession = sid;
        var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === sid; })[0];
        if (sess) renderContextGrowth(sess);
        $all("#ctxBody tr.is-open").forEach(function (r) { r.classList.remove("is-open"); });
        row.classList.add("is-open");
        openContextDrawer(sess, "session");
      } else if (view === "model" || view === "agent") {
        var key = row.getAttribute("data-ctx-key");
        var item = (state.contextUsage[view === "model" ? "byModel" : "byAgent"] || [])
          .filter(function (g) { return g.id === key; })[0];
        openContextDrawer(item, view);
      }
    });
  }
}

export function renderBreakdown(snap) {
  bindCtxControls();
  bindCompositionControls();
  var view = state.contextView || "model";
  var body = $("#ctxBody");
  var empty = $("#ctxEmpty");
  if (!body) return;
  var list = [];

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
        reasoning: m.reasoning,
        peak: m.maxTotal,
        limit: m.contextLimit,
        pct: m.pct,
        lastSeen: m.lastSeen,
        sessionId: null
      };
    });
  } else if (view === "session") {
    list = (snap.bySession || []).map(function (s) {
      return {
        key: s.id,
        name: s.title || s.id,
        title: s.id,
        requests: s.requests,
        input: s.input,
        cached: s.cached,
        output: s.output,
        reasoning: s.reasoning,
        peak: s.maxTotal,
        limit: null,
        pct: 0,
        lastSeen: s.lastSeen,
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
        reasoning: a.reasoning,
        peak: a.maxTotal,
        limit: null,
        pct: 0,
        lastSeen: a.lastSeen,
        sessionId: null
      };
    });
  } else {
    list = (snap.requests || []).map(function (r) {
      return {
        key: r.id,
        name: String(r.id).slice(0, 8),
        title: r.model,
        requests: 1,
        input: r.input,
        cached: r.cached,
        output: r.output,
        reasoning: r.reasoning,
        peak: r.total,
        limit: r.contextLimit,
        pct: r.pct,
        lastSeen: r.time,
        sessionId: null,
        time: r.time
      };
    });
  }

  if (empty) empty.hidden = list.length > 0;
  var maxPeak = list.reduce(function (a, r) { return Math.max(a, r.peak || 0); }, 0);
  body.innerHTML = list.slice(0, 50).map(function (r) {
    var sessionRow = view === "session" ? ' data-session-id="' + esc(r.sessionId) + '"' : "";
    var keyRow = (view === "model" || view === "agent") ? ' data-ctx-key="' + esc(r.key) + '"' : "";
    var clickable = view !== "requests";
    var windowCellHtml = r.limit
      ? windowCell(r.limit, r.peak, r.pct)
      : windowShare(r.peak, maxPeak);
    var total = r.input + r.cached + r.output;
    var cachePct = total > 0 ? (r.cached / total) * 100 : null;
    var avgCtx = view === "requests" ? total : r.requests > 0 ? total / r.requests : 0;
    var lastUsed = r.lastSeen ? formatRelative(r.lastSeen) : "n/a";
    return (
      "<tr data-ctx-row" + sessionRow + keyRow + (clickable ? ' class="ctx-row"' : "") + ">" +
      "<td><span class=\"cell-primary\">" + esc(r.name) + "</span>" +
      '<span class="cell-secondary ctx-row__sub">' + esc(r.title) + "</span></td>" +
      '<td class="numeric">' + nf.format(r.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(r.input) + "</td>" +
      '<td class="numeric">' + formatTokens(r.cached) + "</td>" +
      '<td class="numeric">' + formatTokens(r.output) + "</td>" +
      '<td class="numeric">' + (cachePct === null ? "n/a" : cachePct.toFixed(1) + "%") + "</td>" +
      '<td class="numeric">' + formatTokens(r.peak) + "</td>" +
      '<td class="numeric">' + windowCellHtml + "</td>" +
      '<td class="numeric">' + (view === "requests" ? "n/a" : formatTokens(Math.round(avgCtx))) + "</td>" +
      '<td class="numeric cell-secondary">' + lastUsed + "</td>" +
      "</tr>"
    );
  }).join("");
  icons();
  refreshTooltips();
  if (view === "session" && ctxState.selectedSession) {
    var sess = (snap.bySession || []).filter(function (s) { return s.id === ctxState.selectedSession; })[0];
    if (sess) renderContextGrowth(sess);
  }
}
