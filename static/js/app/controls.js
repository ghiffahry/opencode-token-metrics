/* Control wiring: buttons, filters, search, sorting, nav, theme. */

import { state } from "../core/state.js";
import { $, $all, icons } from "../core/utils.js";
import { exportCSV } from "../data/csv.js";
import { renderModelTable, renderRequests } from "../render/tables.js";
import { renderGraph, refreshGraphTheme } from "../render/graph.js";
import { selectRange, updateRangeButtons } from "./render.js";
import { liveTick, refreshLiveChartTheme } from "../live/manager.js";
import { loadLiveRange, projectLabel } from "../live/api.js";

function toISODate(d) {
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("theme", theme); } catch (e) {}
  $("#themeIcon").setAttribute("data-lucide", theme === "dark" ? "sun" : "moon");
  if (window.lucide) lucide.createIcons();
  refreshLiveChartTheme();
  refreshGraphTheme();
}

export function doRefresh() {
  var btn = $("#refreshBtn");
  btn.classList.add("is-loading");
  liveTick();
  renderGraph(true);
  setTimeout(function () { btn.classList.remove("is-loading"); }, 500);
}

export function initControls() {
  var theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  $("#themeIcon").setAttribute("data-lucide", theme === "dark" ? "sun" : "moon");
  icons();

  $("#themeToggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  $("#sidebarCollapse").addEventListener("click", function () {
    document.body.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebarCollapsed", document.body.classList.contains("sidebar-collapsed") ? "1" : "0"); } catch (e) {}
  });

  $("#menuToggle").addEventListener("click", function () {
    $("#sidebar").classList.add("is-open");
    $("#sidebarBackdrop").hidden = false;
  });

  function closeDrawer() {
    $("#sidebar").classList.remove("is-open");
    $("#sidebarBackdrop").hidden = true;
  }
  $("#sidebarBackdrop").addEventListener("click", closeDrawer);
  $all(".nav-item").forEach(function (item) {
    item.addEventListener("click", function () {
      if (window.innerWidth <= 900) closeDrawer();
    });
  });

  var lastNonCustom = "today";
  $all(".range-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      var rk = b.getAttribute("data-range");
      if (rk === "custom") {
        if (!$("#customFrom").value || !$("#customTo").value) {
          var toD = new Date();
          var fromD = new Date(toD.getTime() - 6 * 86400000);
          $("#customFrom").value = toISODate(fromD);
          $("#customTo").value = toISODate(toD);
        }
        $("#customRange").hidden = false;
        return;
      }
      lastNonCustom = rk;
      $("#customRange").hidden = true;
      selectRange(rk);
    });
  });

  $("#customApply").addEventListener("click", function () {
    var from = $("#customFrom").value;
    var to = $("#customTo").value;
    if (!from || !to) return;
    var fromD = new Date(from + "T00:00:00");
    var toD = new Date(to + "T00:00:00");
    if (fromD > toD) { fromD = toD; from = to; }
    var todayIso = toISODate(new Date());
    if (to > todayIso) { to = todayIso; toD = new Date(to + "T00:00:00"); }
    if (fromD > toD) from = to;
    state.customFrom = from;
    state.customTo = to;
    try {
      localStorage.setItem("customFrom", from);
      localStorage.setItem("customTo", to);
    } catch (e) {}
    $("#customRange").hidden = true;
    selectRange("custom");
  });

  $("#customCancel").addEventListener("click", function () {
    $("#customRange").hidden = true;
    if (state.range !== "custom") updateRangeButtons(lastNonCustom);
  });

  try {
    state.customFrom = localStorage.getItem("customFrom") || "";
    state.customTo = localStorage.getItem("customTo") || "";
    if (state.customFrom) $("#customFrom").value = state.customFrom;
    if (state.customTo) $("#customTo").value = state.customTo;
  } catch (e) {}

  $("#projectSelect").addEventListener("change", function () {
    state.project = this.value;
    try { localStorage.setItem("project", state.project); } catch (e) {}
    loadLiveRange(state.range).catch(function () {});
    renderGraph(false);
  });

  $("#refreshBtn").addEventListener("click", doRefresh);
  $("#exportBtn").addEventListener("click", exportCSV);

  $("#modelSearch").addEventListener("input", function () {
    state.modelSearch = this.value;
    renderModelTable(state.view);
  });

  $("#requestSearch").addEventListener("input", function () {
    state.requestSearch = this.value;
    state.page = 1;
    renderRequests();
  });

  $("#modelFilter").addEventListener("change", function () {
    state.modelFilter = this.value;
    state.page = 1;
    loadLiveRange(state.range).catch(function () {});
  });

  $("#agentFilter").addEventListener("change", function () {
    state.agentFilter = this.value;
    state.page = 1;
    renderRequests();
  });

  $("#prevPage").addEventListener("click", function () {
    state.page = Math.max(1, state.page - 1);
    renderRequests();
  });
  $("#nextPage").addEventListener("click", function () {
    state.page = state.page + 1;
    renderRequests();
  });

  $all("#modelTable th.sortable").forEach(function (th) {
    th.addEventListener("click", function () {
      if (th.querySelector(".info-icon")) return;
      var key = th.getAttribute("data-sort");
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { key: key, dir: key === "model" ? "asc" : "desc" };
      }
      $all("#modelTable th.sortable").forEach(function (t) {
        t.setAttribute("aria-sort", t === th ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none");
      });
      renderModelTable(state.view);
    });
  });

  window.addEventListener("storage", function (e) {
    if (e.key === "theme" && e.newValue) {
      applyTheme(e.newValue);
    }
  });
}

export function initNavSpy() {
  var sections = $all(".section");
  var nav = $all(".nav-item");
  var map = {};
  nav.forEach(function (n) { map[n.getAttribute("data-section")] = n; });
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        nav.forEach(function (n) { n.classList.remove("is-active"); });
        var item = map[entry.target.id];
        if (item) item.classList.add("is-active");
      }
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach(function (s) { observer.observe(s); });
}
