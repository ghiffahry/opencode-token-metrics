/* Context window card: latest request utilisation + peak block. */

import { $, nf, esc, clamp, formatTokens, formatRelative } from "../../core/utils.js";
import { utilClass, utilTextClass } from "./state.js";

function metricsStrip(L) {
  var items = [
    { cls: "uncached", label: "New Input", value: L.input },
    { cls: "cached", label: "Cached", value: L.cached },
    { cls: "output", label: "Output", value: L.output },
    { cls: "reasoning", label: "Reasoning", value: L.reasoning }
  ];
  return (
    '<div class="ctx-metrics">' +
    items.map(function (m) {
      return (
        '<div class="ctx-metrics__item" title="' + nf.format(m.value) + " tokens\">" +
        '<span class="ctx-metrics__label"><i class="ctx-metrics__dot ctx-metrics__dot--' + m.cls + '"></i>' + m.label + "</span>" +
        '<span class="ctx-metrics__value">' + formatTokens(m.value) + "</span>" +
        "</div>"
      );
    }).join("") +
    "</div>"
  );
}

function peakBlock(snap) {
  var p = snap.peak;
  if (!p) return "";
  var limit = p.contextLimit || 1;
  var pct = clamp((p.total / limit) * 100, 0, 100);
  var cls = utilClass(pct);
  return (
    '<div class="ctx-peak">' +
    '<div class="ctx-peak__head">' +
    '<span class="ctx-peak__title">Peak Context</span>' +
    '<span class="ctx-peak__nums" title="' + nf.format(p.total) + " of " + nf.format(limit) + " tokens\">" +
    formatTokens(p.total) + " / " + formatTokens(limit) + "</span>" +
    '<span class="ctx-peak__pct ' + utilTextClass(cls) + '">' + pct.toFixed(1) + "%</span>" +
    "</div>" +
    '<div class="ctx-peak__bar"><div class="ctx-peak__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
    "</div>"
  );
}

export function renderLatest(snap) {
  var el = $("#ctxLatest");
  var empty = $("#ctxLatestEmpty");
  var L = snap.latest;
  if (!L) {
    if (el) el.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  var limit = L.contextLimit || 1;
  var used = L.input + L.cached + L.output + L.reasoning;
  var pctRaw = (used / limit) * 100;
  var over = used > limit;
  var remaining = Math.max(0, limit - used);
  var cls = over ? "is-critical" : utilClass(pctRaw);
  var pctText = over ? "over limit" : pctRaw.toFixed(1) + "% used";

  el.innerHTML =
    '<div class="ctx-win__meta">' +
    '<span class="ctx-win__model">' + esc(L.model.split("/").pop()) + "</span>" +
    '<span class="ctx-win__sep">·</span>' +
    '<span>Latest request</span>' +
    '<span class="ctx-win__sep">·</span>' +
    '<span>' + formatRelative(L.time) + "</span>" +
    "</div>" +
    '<div class="ctx-win__primary">' +
    '<span class="ctx-win__used" title="' + nf.format(used) + " tokens used\">" + formatTokens(used) + "</span>" +
    '<span class="ctx-win__sub">of ' + formatTokens(limit) + " context window</span>" +
    "</div>" +
    '<div class="ctx-win__status">' +
    '<span class="ctx-win__pct ' + utilTextClass(cls) + '">' + pctText + "</span>" +
    '<span class="ctx-win__remain">' + formatTokens(remaining) + " remaining</span>" +
    "</div>" +
    '<div class="ctx-win__bar ' + cls + '" role="img" aria-label="' + pctRaw.toFixed(1) + '% of the context window is used">' +
    '<div class="ctx-win__fill" style="width:' + Math.min(pctRaw, 100).toFixed(1) + '%"></div>' +
    "</div>" +
    metricsStrip(L) +
    peakBlock(snap);
}
