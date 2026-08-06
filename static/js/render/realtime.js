/* Realtime counter cards + update flash. */

import { state } from "../core/state.js";
import { $, $all, nf, icons, formatTokens } from "../core/utils.js";

export function renderLiveCounters() {
  var rt = state.liveRealtime;
  if (!rt) return;
  var rl = (state.view && state.view.rateLimits) || {};
  var rpmLimit = (rl.rpm && rl.rpm.limit) || 60;
  var tpmLimit = (rl.tpm && rl.tpm.limit) || 250000;

  var activeTotal = rt.sessions
    .filter(function (s) { return s.status === "active"; })
    .reduce(function (a, s) { return a + s.input + s.output; }, 0);
  var todayTotal = (rt.today.input || 0) + (rt.today.output || 0);
  var lastTick = state.live.input + state.live.output;

  var cards = [
    { label: "Active sessions", value: String(rt.activeSessions), foot: "+" + formatTokens(lastTick) + " last poll", icon: "layers" },
    { label: "Requests today", value: nf.format(rt.today.requests || 0), foot: "since 00:00", icon: "clock" },
    { label: "Tokens today", value: formatTokens(todayTotal), foot: "live · " + formatTokens(lastTick) + " since load", icon: "calendar-days" },
    { label: "RPM · 1 min", value: nf.format(rt.requestsLastMinute), foot: "of " + nf.format(rpmLimit), icon: "gauge" },
    { label: "TPM · 1 min", value: formatTokens(rt.tokensLastMinute), foot: "of " + formatTokens(tpmLimit), icon: "zap" }
  ];

  $("#realtimeCounters").innerHTML = cards.map(function (c) {
    return (
      '<article class="card live-stat" data-counter>' +
      '<span class="live-stat__label"><i data-lucide="' + c.icon + '"></i>' + c.label + "</span>" +
      '<span class="live-stat__value">' + c.value + "</span>" +
      '<span class="live-stat__foot">' + c.foot + "</span>" +
      "</article>"
    );
  }).join("");
  icons();
}

export function flashLiveCounters() {
  $all("[data-counter] .live-stat__value").forEach(function (el, i) {
    el.classList.remove("is-updating");
    void el.offsetWidth;
    if (i < 2) el.classList.add("is-updating");
  });
}
