/* App bootstrap: initial render, live boot, timers, visibility. */

import { $, $all, cssVar, formatTime } from "../core/utils.js";
import { initControls, initNavSpy } from "./controls.js";
import { initRealtimeChart } from "../render/charts.js";
import { initGraphControls } from "../render/graph.js";
import { startLive } from "../live/manager.js";
import { loadProjects } from "../live/api.js";

export function init() {
  if (window.Chart) {
    Chart.defaults.font.family = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar("--text-secondary");
    Chart.defaults.borderColor = cssVar("--border");
  }

  var collapsed = false;
  try { collapsed = localStorage.getItem("sidebarCollapsed") === "1"; } catch (e) {}
  if (collapsed) document.body.classList.add("sidebar-collapsed");

  initControls();
  initNavSpy();
  initGraphControls();

  if (!window.Chart) {
    $all("canvas").forEach(function (c) { c.style.display = "none"; });
  }

  loadProjects()
    .catch(function () {})
    .then(function () {
      if (window.Chart) initRealtimeChart();
      startLive();
      $("#footerStamp").textContent = "Updated " + formatTime(new Date());
    });
}
