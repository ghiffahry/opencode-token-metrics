/* Estimated context composition card (server-side heuristic). */

import { $, icons, esc, nf, formatTokens, clamp } from "../../core/utils.js";
import { humanCat } from "./state.js";

function compositionRowHtml(s, minor) {
  return (
    '<div class="ctx-comp-row">' +
    '<span class="ctx-comp-row__label" title="' + esc(humanCat(s.category)) + '">' + esc(humanCat(s.category)) + "</span>" +
    '<span class="ctx-comp-row__bar"><span class="ctx-comp-row__fill" style="width:' + clamp(s.pct, 0, 100) + '%"></span></span>' +
    '<span class="numeric ctx-comp-row__tokens" title="' + nf.format(s.tokens) + " tokens\">" + formatTokens(s.tokens) + "</span>" +
    '<span class="numeric ctx-comp-row__share">' + s.pct.toFixed(1) + "%</span>" +
    "</div>"
  );
}

function minorRowHtml(minor, tokens, pct) {
  var subRows = minor.map(function (s) {
    return (
      '<div class="ctx-comp-minor__row">' +
      '<span class="ctx-comp-minor__item-label" title="' + esc(humanCat(s.category)) + '">' + esc(humanCat(s.category)) + "</span>" +
      '<span></span>' +
      '<span class="numeric" title="' + nf.format(s.tokens) + " tokens\">" + formatTokens(s.tokens) + "</span>" +
      '<span class="numeric cell-secondary">' + s.pct.toFixed(1) + "%</span>" +
      "</div>"
    );
  }).join("");
  return (
    '<button type="button" class="ctx-comp-minor" aria-expanded="false">' +
    '<span class="ctx-comp-minor__name" title="Minor Context">' +
    '<span class="ctx-comp-minor__chevron"><i data-lucide="chevron-right"></i></span>' +
    '<span class="ctx-comp-minor__label">Minor Context</span>' +
    "</span>" +
    '<span class="ctx-comp-minor__bar" aria-hidden="true"></span>' +
    '<span class="numeric ctx-comp-minor__tokens" title="' + nf.format(tokens) + " tokens\">" + formatTokens(tokens) + "</span>" +
    '<span class="numeric ctx-comp-minor__share">' + pct.toFixed(1) + "%</span>" +
    "</button>" +
    '<div class="ctx-comp-minor__items" hidden>' + subRows + "</div>"
  );
}

export function renderComposition(snap) {
  var el = $("#ctxComposition");
  var insight = $("#ctxInsight");
  if (insight) insight.hidden = true;
  var comp = snap.composition;
  if (!comp || !comp.segments.length) {
    if (el) el.innerHTML = '<span class="cell-secondary">Not available for this request.</span>';
    return;
  }
  var segs = comp.segments.slice();
  var major = segs.filter(function (s) { return s.pct >= 1; });
  var minor = segs.filter(function (s) { return s.pct < 1; });
  var minorTokens = minor.reduce(function (a, s) { return a + s.tokens; }, 0);
  var minorPct = minor.reduce(function (a, s) { return a + s.pct; }, 0);

  var rows = major.map(function (s) { return compositionRowHtml(s); });
  if (minor.length) rows.push(minorRowHtml(minor, minorTokens, minorPct));

  el.innerHTML =
    '<div class="ctx-comp__head">' +
    '<span>Source</span><span></span><span class="numeric">Tokens</span><span class="numeric">Share</span>' +
    "</div>" +
    '<div class="ctx-comp__rows">' + rows.join("") + "</div>";
  icons();

  if (insight && segs.length) {
    var top = segs[0];
    var text;
    if (top.pct >= 70) {
      text = humanCat(top.category) + " dominates current context usage.";
    } else if (segs[1]) {
      text = (top.pct + segs[1].pct).toFixed(1) + "% of current context comes from " +
        humanCat(top.category) + " + " + humanCat(segs[1].category) + ".";
    }
    if (text) {
      insight.innerHTML = '<i data-lucide="sparkles"></i><span>' + esc(text) + "</span>";
      insight.hidden = false;
      icons();
    }
  }
}

export function bindCompositionControls() {
  var el = $("#ctxComposition");
  var btn = $("#ctxLearnBtn");
  if (el && !el.dataset.bound) {
    el.dataset.bound = "1";
    el.addEventListener("click", function (e) {
      var toggle = e.target.closest(".ctx-comp-minor");
      if (!toggle) return;
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      var items = toggle.nextElementSibling;
      if (items && items.classList.contains("ctx-comp-minor__items")) items.hidden = open;
      icons();
    });
  }
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    var pop = $("#ctxLearnPop");
    function show() {
      var open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      show();
    });
    document.addEventListener("click", function (e) {
      if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) {
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && pop && !pop.hidden) {
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }
}
