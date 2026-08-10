/* Token-efficiency cards: consumption bar, efficiency deltas, health meters. */

import { $, nf, icons, clamp, formatTokens } from "../core/utils.js";

export function renderEfficiency(view) {
  var baseline = view.prev || {};
  var inpPct = (view.input / view.total) * 100;

  $("#effConsumption").innerHTML =
    '<div class="consumption__row">' +
    '<span class="consumption__label">Input tokens</span>' +
    '<span class="consumption__value">' + formatTokens(view.input) + "</span></div>" +
    '<div class="consumption__row">' +
    '<span class="consumption__label">Output tokens</span>' +
    '<span class="consumption__value">' + formatTokens(view.output) + "</span></div>" +
    '<div class="consumption__total">' +
    '<div class="consumption__row">' +
    '<span class="consumption__label">Total consumed</span>' +
    '<span class="consumption__value">' + formatTokens(view.total) + "</span></div>" +
    '<div class="consumption__bar">' +
    '<span class="input" style="width:' + inpPct.toFixed(1) + '%"></span>' +
    '<span class="output" style="width:' + (100 - inpPct).toFixed(1) + '%"></span>' +
    "</div>" +
    '<div class="consumption__legend">' +
    '<span><i style="background:var(--chart-input)"></i>Input ' + inpPct.toFixed(0) + "%</span>" +
    '<span><i style="background:var(--chart-output)"></i>Output ' + (100 - inpPct).toFixed(0) + "%</span>" +
    "</div></div>";

  function effDelta(cur, prev, invert) {
    if (!prev) return '<span class="delta delta--neutral">-</span>';
    var pct = ((cur - prev) / prev) * 100;
    var good = invert ? pct < 0 : pct > 0;
    var cls = Math.abs(pct) < 0.05 ? "neutral" : good ? "better" : "worse";
    var icon = Math.abs(pct) < 0.05 ? "minus" : pct > 0 ? "arrow-up-right" : "arrow-down-right";
    return '<span class="delta delta--' + cls + '"><i data-lucide="' + icon + '"></i>' + (pct > 0 ? "+" : "") + pct.toFixed(1) + "%</span>";
  }

  $("#effEfficiency").innerHTML =
    '<div class="efficiency-item">' +
    '<span class="efficiency-item__label">Ratio (out : in)</span>' +
    '<span class="efficiency-item__right"><span class="efficiency-item__value">' + view.ratio.toFixed(2) + "</span>" +
    effDelta(view.ratio, baseline.ratio, false) + "</span></div>" +
    '<div class="efficiency-item">' +
    '<span class="efficiency-item__label">Avg input / request</span>' +
    '<span class="efficiency-item__right"><span class="efficiency-item__value">' + nf.format(view.avgIn) + "</span>" +
    effDelta(view.avgIn, baseline.avgIn, true) + "</span></div>" +
    '<div class="efficiency-item">' +
    '<span class="efficiency-item__label">Avg output / request</span>' +
    '<span class="efficiency-item__right"><span class="efficiency-item__value">' + nf.format(view.avgOut) + "</span>" +
    effDelta(view.avgOut, baseline.avgOut, true) + "</span></div>";
  icons();

  var health = [];
  var rl = view.rateLimits;
  health.push({ label: "RPM", used: rl.rpm.used, limit: rl.rpm.limit, fmt: nf.format });
  health.push({ label: "TPM", used: rl.tpm.used, limit: rl.tpm.limit, fmt: formatTokens });
  health.push({ label: "RPD", used: rl.rpd.used, limit: rl.rpd.limit, fmt: formatTokens });

  $("#effHealth").innerHTML = health.map(function (h) {
    var known = Number.isFinite(h.limit) && h.limit > 0;
    var pct = known ? clamp((h.used / h.limit) * 100, 0, 100) : 0;
    var cls = pct >= 90 ? "is-danger" : pct >= 80 ? "is-warning" : "";
    return (
      '<div class="health-item">' +
      '<div class="health-item__top"><span class="health-item__label">' + h.label + "</span>" +
      '<span class="health-item__value">' + h.fmt(h.used) + " / " + (known ? h.fmt(h.limit) : "?") + "</span></div>" +
      '<div class="progress"><span class="progress__bar ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
      "</div>"
    );
  }).join("");
}
