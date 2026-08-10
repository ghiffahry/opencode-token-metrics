/* Reusable tooltip component: viewport-aware, keyboard-focus friendly.
   Upgrade elements carrying data-tip / data-tip-title into styled popovers
   that stay inside the viewport and wrap long text. */

import { $all, esc } from "../core/utils.js";

var tipEl = null;

function ensureEl() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tooltip-pop";
    tipEl.hidden = true;
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function position(pop, anchor) {
  var r = anchor.getBoundingClientRect();
  var pw = pop.offsetWidth;
  var ph = pop.offsetHeight;
  var x = r.left + r.width / 2 - pw / 2;
  var y = r.bottom + 8;
  if (x < 8) x = 8;
  if (x + pw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - pw - 8);
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 8);
  pop.style.left = x + "px";
  pop.style.top = y + "px";
}

function hide() {
  if (tipEl) tipEl.hidden = true;
}

export function bindTooltip(el) {
  var tip = el.getAttribute("data-tip");
  if (!tip || el.classList.contains("tooltip-host")) return;
  var title = el.getAttribute("data-tip-title") || "";
  if (el.hasAttribute("title")) el.removeAttribute("title");
  el.classList.add("tooltip-host");

  function show() {
    var pop = ensureEl();
    pop.innerHTML = (title
      ? '<span class="tooltip-pop__title">' + esc(title) + "</span>" : "") + esc(tip);
    pop.hidden = false;
    position(pop, el);
  }

  el.addEventListener("mouseenter", show);
  el.addEventListener("mouseleave", hide);
  el.addEventListener("focus", show);
  el.addEventListener("blur", hide);
  el.addEventListener("click", hide);
}

export function initTooltips() {
  $all("[data-tip]").forEach(bindTooltip);
}

export function refreshTooltips() {
  initTooltips();
}
