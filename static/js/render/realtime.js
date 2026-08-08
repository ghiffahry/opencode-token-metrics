/* Realtime counter cards + update flash.
   Quota-window cards (Requests/Tokens in window) vs rolling-window cards
   (RPM/TPM) are distinguished in the subtitle so the two semantics are
   never conflated. */

import { state } from "../core/state.js";
import { $, $all, nf, icons, formatTokens, exact } from "../core/utils.js";
import { refreshTooltips } from "../ui/tooltip.js";

export function renderLiveCounters() {
  var rt = state.liveRealtime;
  if (!rt) return;
  var rl = (state.view && state.view.rateLimits) || {};
  var rpmLimit = (rl.rpm && rl.rpm.limit) || 60;
  var tpmLimit = (rl.tpm && rl.tpm.limit) || 250000;

  var activeTotal = rt.sessions
    .filter(function (s) { return s.status === "active"; })
    .reduce(function (a, s) { return a + s.input + s.output; }, 0);
  var win = rt.window || {};
  var winTotal = (win.input || 0) + (win.output || 0);
  var lastTick = state.live.input + state.live.output;

  var cards = [
    { label: "Active sessions", value: String(rt.activeSessions), foot: "+" + formatTokens(lastTick) + " last poll", icon: "layers", tip: "Sessions with activity in the last 10 minutes. Includes input + output tokens consumed." },
    { label: "Requests in window", value: nf.format(win.requests || 0), foot: "quota window · estimated reset", icon: "clock", tip: "Requests completed inside the current estimated 14h quota window. Reset is not tied to midnight.", exact: exact(win.requests || 0) },
    { label: "Tokens in window", value: formatTokens(winTotal), foot: "quota window · estimated reset", icon: "calendar-days", tip: "Input + output tokens consumed inside the current estimated 14h quota window. Not a calendar day.", exact: exact(winTotal) },
    { label: "RPM · 1 min", value: nf.format(rt.requestsLastMinute), foot: "rolling 60s · of " + nf.format(rpmLimit), icon: "gauge", tip: "Requests completed in the rolling 60-second window vs. the configured quota.", exact: exact(rt.requestsLastMinute) },
    { label: "TPM · 1 min", value: formatTokens(rt.tokensLastMinute), foot: "rolling 60s · of " + formatTokens(tpmLimit), icon: "zap", tip: "Input + output tokens processed in the rolling 60-second window vs. the configured quota.", exact: exact(rt.tokensLastMinute) }
  ];

  $("#realtimeCounters").innerHTML = cards.map(function (c) {
    return (
      '<article class="card live-stat" data-counter>' +
      '<span class="live-stat__label" data-tip="' + c.tip + '"><i data-lucide="' + c.icon + '"></i>' + c.label + "</span>" +
      '<span class="live-stat__value" title="' + (c.exact || c.value) + '">' + c.value + "</span>" +
      '<span class="live-stat__foot">' + c.foot + "</span>" +
      "</article>"
    );
  }).join("");
  icons();
  refreshTooltips();
}

export function flashLiveCounters() {
  $all("[data-counter] .live-stat__value").forEach(function (el, i) {
    el.classList.remove("is-updating");
    void el.offsetWidth;
    if (i < 2) el.classList.add("is-updating");
  });
}
