/* Right-side session drawer: opens when an Active Sessions row is clicked.
   Shows session metadata, context utilisation and recent requests without
   navigating away from the dashboard. */

import { state } from "../core/state.js";
import { $, esc, icons, formatTokens, formatLatency, formatRelative, formatDateTime } from "../core/utils.js";

var bound = false;

function open() {
  $("#sessionDrawer").hidden = false;
  $("#sessionDrawer").setAttribute("aria-hidden", "false");
  $("#drawerScrim").hidden = false;
  $("#sessionDrawerClose").focus();
}

function close() {
  $("#sessionDrawer").hidden = true;
  $("#sessionDrawer").setAttribute("aria-hidden", "true");
  $("#drawerScrim").hidden = true;
}

function row(label, value, valueClass) {
  return '<div class="drawer-row"><span class="drawer-row__label">' + esc(label) +
    '</span><span class="drawer-row__value ' + (valueClass || "") + '">' + value + "</span></div>";
}

function bindOnce() {
  if (bound) return;
  bound = true;
  $("#sessionDrawerClose").addEventListener("click", close);
  $("#drawerScrim").addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("#sessionDrawer").hidden) close();
  });
}

export function openSessionDrawer(session) {
  if (!session) return;
  bindOnce();
  var body = $("#sessionDrawerBody");
  var ctxPct = session.contextLimit
    ? Math.min(100, (session.contextUsed / session.contextLimit) * 100) : 0;
  var ctxCls = ctxPct >= 90 ? "is-danger-text" : ctxPct >= 75 ? "" : "";

  var recent = (state.liveRequests || [])
    .filter(function (r) { return r.sessionId === session.id; })
    .slice(0, 8);

  body.innerHTML =
    '<div class="drawer-sec">' +
    '<div class="drawer-sec__title">Session</div>' +
    row("ID", '<span class="mono">' + esc(session.id) + "</span>") +
    row("Model", esc(session.model)) +
    row("Agent", esc(session.agent)) +
    row("Status", esc(session.status)) +
    row("Started", formatDateTime(session.timeCreated)) +
    row("Last activity", formatRelative(session.timeUpdated)) +
    "</div>" +

    '<div class="drawer-sec">' +
    '<div class="drawer-sec__title">Context</div>' +
    row("Current context", formatTokens(session.input) + " / " + formatTokens(session.contextLimit || 0),
      session.contextLimit && ctxPct >= 90 ? "is-danger-text" : "") +
    row("Utilisation", ctxPct.toFixed(1) + "%", ctxCls) +
    row("Input", formatTokens(session.input)) +
    row("Cached", formatTokens(session.cacheRead)) +
    row("Output", formatTokens(session.output)) +
    row("Reasoning", formatTokens(session.reasoning)) +
    "</div>" +

    '<div class="drawer-sec">' +
    '<div class="drawer-sec__title">Recent requests</div>' +
    (recent.length
      ? recent.map(function (r) {
          return (
            '<div class="drawer-req">' +
            '<span class="mono">' + esc(String(r.id).slice(0, 10)) + "</span>" +
            '<span class="drawer-req__right">' +
            formatTokens(r.input) + " / " + formatTokens(r.output) +
            " · " + formatLatency(r.latency) +
            "</span></div>"
          );
        }).join("")
      : '<span class="cell-secondary">No requests in the current window.</span>') +
    "</div>" +

    '<div class="drawer-actions">' +
    '<button class="btn btn--primary" id="drawerInspectCtx" type="button">Inspect Context</button>' +
    '<button class="btn btn--ghost" id="drawerViewRequests" type="button">View Requests</button>' +
    "</div>";

  icons();
  open();

  $("#drawerInspectCtx").addEventListener("click", function () {
    close();
    var ctx = document.getElementById("context");
    var el = ctx;
    if (el) el.scrollIntoView({ behavior: "smooth" });
    try {
      import("../render/context/index.js").then(function (m) {
        m.selectSessionInContext(session.id);
      });
    } catch (e) {}
  });

  $("#drawerViewRequests").addEventListener("click", function () {
    close();
    var search = $("#requestSearch");
    if (search) search.value = session.id;
    state.requestSearch = session.id;
    state.page = 1;
    var el = document.getElementById("requests");
    if (el) el.scrollIntoView({ behavior: "smooth" });
    try {
      import("../render/tables.js").then(function (m) {
        m.renderRequests();
      });
      import("../ui/chips.js").then(function (m) { m.updateChips(); });
    } catch (e) {}
  });
}
