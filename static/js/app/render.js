/* Full render orchestration + range switching. */

import { state } from "../core/state.js";
import { $, $all, formatTime } from "../core/utils.js";
import { renderKpis } from "../render/kpis.js";
import { renderEfficiency } from "../render/efficiency.js";
import { renderBarCharts, renderUsageChart, renderStagesChart } from "../render/charts.js";
import { renderModelTable, renderRequests, renderPerDay, renderSessionTable, renderRateLimits } from "../render/tables.js";
import { renderLiveCounters } from "../render/realtime.js";
import { renderGraph } from "../render/graph.js";
import { loadLiveRange, projectLabel } from "../live/api.js";

export function updateRangeButtons(rangeKey) {
  $all(".range-btn").forEach(function (b) {
    var on = b.getAttribute("data-range") === rangeKey;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function renderAll() {
  var view = state.view;
  renderKpis(view);
  renderEfficiency(view);
  renderBarCharts(view);
  renderUsageChart(view);
  renderStagesChart(view);
  renderModelTable(view);
  renderRequests();
  renderPerDay(view);
  renderSessionTable();
  renderRateLimits(view);
  renderLiveCounters();
  renderGraph();

  $("#overviewSub").textContent = projectLabel(state.project) + " · " + view.rangeLabel;
  $("#usageSub").textContent = view.range === "1d" ? "Hourly" : view.range === "90d" ? "Weekly" : "Daily";
  $("#modelsSub").textContent = "Aggregated · " + view.rangeLabel;
  $("#limitsSub").textContent = "Live quota utilisation";
  $("#footerStamp").textContent = "Updated " + formatTime(new Date());
}

export function selectRange(rangeKey) {
  state.range = rangeKey;
  state.page = 1;
  updateRangeButtons(rangeKey);
  loadLiveRange(rangeKey);
}
