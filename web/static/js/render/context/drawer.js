/* Context details drawer: per model / agent / session summary. */

import { state } from "../../core/state.js";
import { $, esc, nf, formatTokens, formatRelative, formatDateTime, icons } from "../../core/utils.js";
import { utilClass, utilTextClass, ctxState } from "./state.js";
import { renderContextGrowth } from "./growth.js";

function drawerRow(label, value, valueClass) {
  return '<div class="drawer-row"><span class="drawer-row__label">' + esc(label) +
    '</span><span class="drawer-row__value ' + (valueClass || "") + '">' + value + "</span></div>";
}

function drawerSection(title, rows) {
  return '<div class="drawer-sec"><div class="drawer-sec__title">' + esc(title) + "</div>" + rows.join("") + "</div>";
}

function latestRequestFor(key, isModel) {
  var reqs = (state.contextUsage.requests || []).slice();
  for (var i = reqs.length - 1; i >= 0; i--) {
    if (isModel ? reqs[i].model === key : reqs[i].agent === key) return reqs[i];
  }
  return null;
}

export function openContextDrawer(item, view) {
  if (!item) return;
  bindDrawerControls();
  var drawer = $("#ctxDrawer");
  var body = $("#ctxDrawerBody");
  $("#ctxDrawerTitle").textContent = view === "session" ? "Session" : view === "agent" ? "Agent" : "Model";

  var peak = item.maxTotal || item.peak || 0;
  var lastSeen = item.lastSeen || 0;
  var isModel = view === "model";
  var current = view === "session" ? null : latestRequestFor(item.id, isModel);
  var total = item.input + item.cached + item.output;
  var cachePct = total > 0 ? (item.cached / total) * 100 : null;
  var avgCtx = item.requests > 0 ? total / item.requests : 0;
  var limit = item.contextLimit || (current && current.contextLimit) || 0;
  var peakPct = limit > 0 ? (peak / limit) * 100 : null;
  var ctxPct = limit > 0 ? Math.min(100, peakPct || 0) : 0;
  var cls = utilClass(ctxPct);

  var contextRows = [];
  if (current) {
    var curUsed = current.input + current.cached + current.output + current.reasoning;
    var curLimit = current.contextLimit || 1;
    var curPct = (curUsed / curLimit) * 100;
    var curCls = utilClass(curPct);
    contextRows.push(
      '<div class="drawer-bar">' +
      '<div class="drawer-bar__fill ' + curCls + '" style="width:' + Math.min(curPct, 100).toFixed(1) + '%"></div>' +
      "</div>" +
      drawerRow("Current context", formatTokens(curUsed) + " / " + formatTokens(curLimit),
        utilTextClass(curCls)) +
      drawerRow("Window usage", curPct.toFixed(1) + "%", utilTextClass(curCls))
    );
  }
  contextRows.push(drawerRow("Average context", formatTokens(Math.round(avgCtx))));
  contextRows.push(drawerRow("Peak context", formatTokens(peak) +
    (peakPct !== null ? " · " + peakPct.toFixed(1) + "%" : ""), utilTextClass(cls)));
  if (cachePct !== null) contextRows.push(drawerRow("Cache ratio", cachePct.toFixed(1) + "%"));
  contextRows.push(drawerRow("Total requests", nf.format(item.requests)));

  body.innerHTML =
    '<div class="ctx-drawer__id">' + esc(item.id) + "</div>" +
    drawerSection("Context", contextRows) +
    drawerSection("Activity", [
      drawerRow("Last activity", formatRelative(lastSeen) + " · " + formatDateTime(lastSeen))
    ]) +
    (view === "session"
      ? '<div class="drawer-actions">' +
        '<button class="btn btn--primary" id="ctxDrawerGrowth" type="button">Inspect growth</button>' +
        "</div>"
      : "");

  icons();
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  $("#ctxDrawerScrim").hidden = false;
  ctxState.drawerOpen = true;
  $("#ctxDrawerClose").focus();

  var gBtn = $("#ctxDrawerGrowth");
  if (gBtn) {
    gBtn.addEventListener("click", function () {
      closeContextDrawer();
      ctxState.selectedSession = item.id;
      var card = $("#ctxGrowthCard");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      if (item.growth) renderContextGrowth(item);
      else {
        var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === item.id; })[0];
        if (sess) renderContextGrowth(sess);
      }
    });
  }
}

function bindDrawerControls() {
  if (document.getElementById("ctxDrawer").dataset.bound) return;
  document.getElementById("ctxDrawer").dataset.bound = "1";
  function close() { closeContextDrawer(); }
  $("#ctxDrawerClose").addEventListener("click", close);
  $("#ctxDrawerScrim").addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ctxState.drawerOpen) closeContextDrawer();
  });
}

export function closeContextDrawer() {
  $("#ctxDrawer").hidden = true;
  $("#ctxDrawer").setAttribute("aria-hidden", "true");
  $("#ctxDrawerScrim").hidden = true;
  ctxState.drawerOpen = false;
}
