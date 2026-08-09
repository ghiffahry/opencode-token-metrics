/* Control wiring: buttons, filters, search, sorting, nav, theme. */

import { state } from "../core/state.js";
import { $, $all, icons } from "../core/utils.js";
import { exportCSV, exportJSON, exportPNG, exportSummary } from "../data/export.js";
import { renderModelTable, renderRequests } from "../render/tables.js";
import { renderGraph, refreshGraphTheme } from "../render/graph.js";
import { setStreamWindow } from "../render/charts.js";
import { openSessionDrawer } from "../ui/sessionDrawer.js";
import { updateChips } from "../ui/chips.js";
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

/* ---------------- Sidebar collapse ----------------
   Labels are conditionally rendered (removed from layout) instead of being
   clipped by the shrinking container. On collapse they fade out first
   (--transition-label), then the sidebar width animates (--transition-sidebar).
   On mobile the sidebar becomes a full drawer, so labels stay visible. */
var SIDEBAR_FADE_MS = 100;
var SIDEBAR_WIDTH_MS = 200;
var sidebarToken = 0;

function isDesktopNav() {
  return window.innerWidth > 900;
}

function syncSidebarLabels(collapsed) {
  var show = !collapsed || !isDesktopNav();
  $all(".nav-item").forEach(function (a) {
    var label = a.querySelector(".nav-label");
    if (!label) return;
    if (show) {
      label.removeAttribute("hidden");
      a.removeAttribute("title");
    } else {
      a.setAttribute("title", label.textContent.trim());
      label.setAttribute("hidden", "");
    }
  });
  $all(".nav-group__toggle").forEach(function (b) {
    var span = b.querySelector("span");
    if (!span) return;
    if (show) {
      span.removeAttribute("hidden");
      b.removeAttribute("title");
    } else {
      b.setAttribute("title", span.textContent.trim());
      span.setAttribute("hidden", "");
    }
  });
  var brand = $(".brand-text");
  var mark = $(".brand-mark");
  if (brand) {
    if (show) {
      brand.removeAttribute("hidden");
      if (mark) mark.removeAttribute("title");
    } else {
      brand.setAttribute("hidden", "");
      if (mark) mark.setAttribute("title", "Token Metrics");
    }
  }
  var card = $("#systemStatus");
  var cardBody = $(".status-card__body");
  if (cardBody) {
    if (show) {
      cardBody.removeAttribute("hidden");
      if (card) card.removeAttribute("title");
    } else {
      cardBody.setAttribute("hidden", "");
      if (card) {
        var t = $("#statusTitle");
        var m = $("#statusMeta");
        card.setAttribute("title", (t ? t.textContent.trim() : "Status") + " · " + (m ? m.textContent.trim() : ""));
      }
    }
  }
}

function setSidebarCollapsed(collapsed) {
  var body = document.body;
  if (collapsed === body.classList.contains("sidebar-collapsed")) return;
  var token = ++sidebarToken;
  if (!isDesktopNav()) {
    body.classList.toggle("sidebar-collapsed", collapsed);
    syncSidebarLabels(collapsed);
    return;
  }
  if (collapsed) {
    /* fade labels out first, then shrink the width */
    body.classList.add("sidebar-fading");
    setTimeout(function () {
      if (token !== sidebarToken) return;
      body.classList.remove("sidebar-fading");
      body.classList.add("sidebar-collapsed");
      syncSidebarLabels(true);
    }, SIDEBAR_FADE_MS);
  } else {
    /* grow the width first (labels stay hidden), then fade labels in so
       text is never clipped mid-word while the sidebar expands */
    body.classList.remove("sidebar-collapsed");
    body.classList.add("sidebar-fading");
    void body.offsetWidth;
    setTimeout(function () {
      if (token !== sidebarToken) return;
      syncSidebarLabels(false);
      void body.offsetWidth;
      body.classList.remove("sidebar-fading");
    }, SIDEBAR_WIDTH_MS);
  }
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
    var collapsed = !document.body.classList.contains("sidebar-collapsed");
    setSidebarCollapsed(collapsed);
    try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch (e) {}
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

  $("#refreshBtn").addEventListener("click", doRefresh);
  $("#bannerRetry").addEventListener("click", doRefresh);

  /* ---------------- Export menu ---------------- */
  var exportMenuEl = $("#exportMenu");
  function refreshExportSummary() {
    var s = exportSummary();
    var pe = $("#exportPeriod");
    if (pe) pe.textContent = s.period;
    var fe = $("#exportFilters");
    if (fe) fe.textContent = s.filters;
  }
  $("#exportBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var open = exportMenuEl.hidden;
    exportMenuEl.hidden = !open;
    this.setAttribute("aria-expanded", String(!open));
    if (!open) refreshExportSummary();
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".export-wrap")) exportMenuEl.hidden = true;
  });
  $all("[data-export]", exportMenuEl).forEach(function (b) {
    b.addEventListener("click", function () {
      var kind = b.getAttribute("data-export");
      if (kind === "csv") exportCSV();
      else if (kind === "json") exportJSON();
      else if (kind === "png") exportPNG();
      exportMenuEl.hidden = true;
    });
  });

  /* ---------------- Custom range presets ---------------- */
  $all("[data-preset]", $("#customPresets")).forEach(function (b) {
    b.addEventListener("click", function () {
      var p = b.getAttribute("data-preset");
      var toD = new Date();
      var fromD;
      if (p === "today") fromD = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate());
      else if (p === "yesterday") { fromD = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate() - 1); toD = new Date(fromD); }
      else if (p === "7d") fromD = new Date(toD.getTime() - 6 * 86400000);
      else if (p === "30d") fromD = new Date(toD.getTime() - 29 * 86400000);
      else if (p === "month") fromD = new Date(toD.getFullYear(), toD.getMonth(), 1);
      else if (p === "prevmonth") { fromD = new Date(toD.getFullYear(), toD.getMonth() - 1, 1); toD = new Date(toD.getFullYear(), toD.getMonth(), 0); }
      state.customFrom = toISODate(fromD);
      state.customTo = toISODate(toD);
      try {
        localStorage.setItem("customFrom", state.customFrom);
        localStorage.setItem("customTo", state.customTo);
      } catch (e) {}
      $("#customFrom").value = state.customFrom;
      $("#customTo").value = state.customTo;
      $("#customRange").hidden = true;
      selectRange("custom");
    });
  });

  /* ---------------- Ctrl+K: focus global search ---------------- */
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      var rs = $("#requestSearch");
      if (rs) { rs.focus(); rs.select(); }
    }
  });

  /* ---------------- Sidebar group collapse ---------------- */
  $all(".nav-group__toggle").forEach(function (t) {
    t.addEventListener("click", function () {
      var g = t.closest(".nav-group");
      var collapsed = g.classList.toggle("is-collapsed");
      t.setAttribute("aria-expanded", String(!collapsed));
      try {
        var saved = JSON.parse(localStorage.getItem("navGroups") || "{}");
        saved[g.getAttribute("data-group")] = collapsed;
        localStorage.setItem("navGroups", JSON.stringify(saved));
      } catch (e) {}
    });
  });
  try {
    var savedGroups = JSON.parse(localStorage.getItem("navGroups") || "{}");
    $all(".nav-group").forEach(function (g) {
      if (savedGroups[g.getAttribute("data-group")]) {
        g.classList.add("is-collapsed");
        var t = g.querySelector(".nav-group__toggle");
        if (t) t.setAttribute("aria-expanded", "false");
      }
    });
  } catch (e) {}

  /* ---------------- Live stream controls ---------------- */
  var WINDOWS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
  function updateStreamMeta() {
    var meta = $("#streamMeta");
    if (!meta) return;
    var wl = Object.keys(WINDOWS).filter(function (k) { return WINDOWS[k] === state.liveWindow; })[0] || "1m";
    meta.textContent = state.livePaused ? "paused · window " + wl : "streaming · window " + wl;
  }
  $all("[data-window]", $("#streamWindows")).forEach(function (b) {
    b.addEventListener("click", function () {
      $all("[data-window]", $("#streamWindows")).forEach(function (x) {
        var on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", String(on));
      });
      setStreamWindow(WINDOWS[b.getAttribute("data-window")] || 60);
      updateStreamMeta();
    });
  });
  var pauseBtn = $("#streamPause");
  pauseBtn.addEventListener("click", function () {
    state.livePaused = !state.livePaused;
    pauseBtn.setAttribute("aria-pressed", String(state.livePaused));
    pauseBtn.setAttribute("aria-label", state.livePaused ? "Resume stream" : "Pause stream");
    pauseBtn.title = state.livePaused ? "Resume streaming" : "Pause streaming";
    pauseBtn.innerHTML = '<i data-lucide="' + (state.livePaused ? "play" : "pause") + '"></i>';
    icons();
    updateStreamMeta();
  });
  updateStreamMeta();

  /* ---------------- Filter changes sync chips ---------------- */
  $("#projectSelect").addEventListener("change", function () {
    state.project = this.value;
    try { localStorage.setItem("project", state.project); } catch (e) {}
    loadLiveRange(state.range).catch(function () {});
    renderGraph(false);
  });

  $("#modelSearch").addEventListener("input", function () {
    state.modelSearch = this.value;
    renderModelTable(state.view);
  });

  $("#requestSearch").addEventListener("input", function () {
    state.requestSearch = this.value;
    state.page = 1;
    renderRequests();
    updateChips();
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
    updateChips();
  });

  /* ---------------- Row interactions ---------------- */
  $("#modelBody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-model-id]");
    if (!tr) return;
    var id = tr.getAttribute("data-model-id");
    state.modelFilter = state.modelFilter === id ? "all" : id;
    $("#modelFilter").value = state.modelFilter;
    state.page = 1;
    loadLiveRange(state.range).catch(function () {});
  });

  $("#sessionBody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-session-id]");
    if (!tr) return;
    var id = tr.getAttribute("data-session-id");
    var list = (state.liveRealtime && state.liveRealtime.sessions) || [];
    var sess = list.filter(function (s) { return s.id === id; })[0];
    if (sess) openSessionDrawer(sess);
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

  syncSidebarLabels(document.body.classList.contains("sidebar-collapsed"));

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var collapsed = document.body.classList.contains("sidebar-collapsed");
      syncSidebarLabels(collapsed);
      if (collapsed && !isDesktopNav()) {
        document.body.classList.remove("sidebar-collapsed");
        try { localStorage.setItem("sidebarCollapsed", "0"); } catch (e) {}
      }
    }, 150);
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
