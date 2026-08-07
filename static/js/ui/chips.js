/* Active-filter chip bar: renders the current project / range / model /
   agent / search filters as removable chips plus a Clear-all action. */

import { state } from "../core/state.js";
import { $, $all, esc, icons } from "../core/utils.js";
import { loadLiveRange, projectLabel } from "../live/api.js";

var CHIP_DEFS = [
  {
    key: "project",
    active: function () { return state.project !== "(unknown)"; },
    label: function () { return "Project: " + projectLabel(state.project); },
    clear: function () { state.project = "(unknown)"; }
  },
  {
    key: "range",
    active: function () { return state.range !== "today"; },
    label: function () {
      var m = { "7d": "7D", "30d": "30D", "90d": "90D", "24h": "Last 24h", custom: "Custom" };
      return "Range: " + (m[state.range] || state.range);
    },
    clear: function () { state.range = "today"; }
  },
  {
    key: "model",
    active: function () { return state.modelFilter !== "all"; },
    label: function () { return "Model: " + state.modelFilter.split("/").pop(); },
    clear: function () { state.modelFilter = "all"; }
  },
  {
    key: "agent",
    active: function () { return state.agentFilter !== "all"; },
    label: function () { return "Agent: " + state.agentFilter; },
    clear: function () { state.agentFilter = "all"; }
  },
  {
    key: "search",
    active: function () { return !!state.requestSearch; },
    label: function () { return "Search: " + state.requestSearch; },
    clear: function () { state.requestSearch = ""; }
  }
];

function syncSelectors() {
  var ms = $("#modelFilter");
  var as = $("#agentFilter");
  if (ms && ms.value !== state.modelFilter) ms.value = state.modelFilter;
  if (as && as.value !== state.agentFilter) as.value = state.agentFilter;
  var ps = $("#projectSelect");
  if (ps && ps.value !== state.project) ps.value = state.project;
  $all(".range-btn").forEach(function (b) {
    var on = b.getAttribute("data-range") === state.range;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function updateChips() {
  var bar = $("#filterChips");
  if (!bar) return;
  var active = CHIP_DEFS.filter(function (c) { return c.active(); });
  if (!active.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = active.map(function (c) {
    return (
      '<span class="filter-chip" data-chip="' + c.key + '">' +
      esc(c.label()) +
      '<button type="button" aria-label="Remove filter" title="Remove filter"><i data-lucide="x"></i></button>' +
      "</span>"
    );
  }).join("") +
    '<button class="filter-chips__clear" type="button">Clear all</button>';
  icons();

  bar.querySelectorAll(".filter-chip button").forEach(function (b) {
    b.addEventListener("click", function () {
      var key = b.closest(".filter-chip").getAttribute("data-chip");
      var def = CHIP_DEFS.filter(function (c) { return c.key === key; })[0];
      if (!def) return;
      def.clear();
      syncSelectors();
      var search = $("#requestSearch");
      if (search) search.value = state.requestSearch;
      if (key === "range") {
        loadLiveRange("today").catch(function () {});
      } else {
        loadLiveRange(state.range).catch(function () {});
      }
      updateChips();
    });
  });
  var clear = bar.querySelector(".filter-chips__clear");
  if (clear) {
    clear.addEventListener("click", function () {
      CHIP_DEFS.forEach(function (c) { c.clear(); });
      syncSelectors();
      var search = $("#requestSearch");
      if (search) search.value = "";
      loadLiveRange("today").catch(function () {});
      updateChips();
    });
  }
}
