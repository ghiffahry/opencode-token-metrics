/* Conversation growth chart + session picker. */

import { state, chartRegistry } from "../../core/state.js";
import { $, $all, esc, nf, formatTokens, cssVar, hexToRgba, icons } from "../../core/utils.js";
import { ctxState } from "./state.js";
import { renderBreakdown } from "./breakdown.js";

export function showGrowthEmpty() {
  var empty = $("#ctxGrowthEmpty");
  var wrap = $("#ctxGrowthWrap");
  var meta = $("#ctxGrowthMeta");
  var card = $("#ctxGrowthCard");
  if (ctxState.growthChart) { ctxState.growthChart.destroy(); ctxState.growthChart = null; }
  if (empty) empty.hidden = false;
  if (wrap) wrap.hidden = true;
  if (meta) meta.hidden = true;
  if (card) card.classList.remove("has-session");
}

export function bindGrowthControls() {
  var btn = $("#ctxGrowthSelect");
  var menu = $("#ctxSessionMenu");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";

  function renderMenu() {
    var sessions = (state.contextUsage.bySession || []).slice();
    if (!sessions.length) {
      menu.innerHTML = '<div class="ctx-session-menu__empty">No sessions in range</div>';
      return;
    }
    menu.innerHTML = sessions.map(function (s) {
      var peak = s.maxTotal || s.peak || 0;
      return (
        '<button type="button" class="ctx-session-menu__item" role="option" data-sid="' + esc(s.id) + '">' +
        '<span class="ctx-session-menu__name" title="' + esc(s.id) + '">' + esc(s.title || s.id) + "</span>" +
        '<span class="ctx-session-menu__meta">' +
        nf.format(s.requests) + " requests · " + formatTokens(peak) + " peak" +
        "</span>" +
        "</button>"
      );
    }).join("");
  }

  menu.addEventListener("click", function (e) {
    var item = e.target.closest("[data-sid]");
    if (!item) return;
    toggleMenu(false);
    selectSessionInContext(item.getAttribute("data-sid"));
  });

  function toggleMenu(open) {
    var isOpen = menu.hidden !== true;
    var next = typeof open === "boolean" ? open : !isOpen;
    menu.hidden = !next;
    btn.setAttribute("aria-expanded", String(next));
    if (next) {
      renderMenu();
      icons();
    }
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener("click", function (e) {
    if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== btn) {
      toggleMenu(false);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu && !menu.hidden) toggleMenu(false);
  });
}

export function selectSessionInContext(sid) {
  var seg = $("#ctxSegmented");
  if (seg) {
    $all(".segment-btn", seg).forEach(function (b) {
      var on = b.getAttribute("data-ctx-view") === "session";
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  state.contextView = "session";
  ctxState.selectedSession = sid;
  var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === sid; })[0];
  if (sess) renderContextGrowth(sess);
  renderBreakdown(state.contextUsage);
}

export function renderContextGrowth(session) {
  var canvas = $("#ctxGrowth");
  if (!canvas || !window.Chart) return;
  var snap = state.contextUsage;
  var growth = (session.growth || []);
  if (!growth.length) {
    showGrowthEmpty();
    return;
  }
  if (ctxState.growthChart) { ctxState.growthChart.destroy(); ctxState.growthChart = null; }
  var empty = $("#ctxGrowthEmpty");
  var wrap = $("#ctxGrowthWrap");
  var meta = $("#ctxGrowthMeta");
  var card = $("#ctxGrowthCard");
  if (empty) empty.hidden = true;
  if (wrap) wrap.hidden = false;
  if (card) card.classList.add("has-session");
  if (meta) {
    meta.hidden = false;
    meta.textContent = (session.title || session.id) + " · " + growth.length + " messages";
  }

  var limit = null;
  (snap.requests || []).some(function (r) {
    if (r.sessionId === session.id && r.contextLimit) { limit = r.contextLimit; return true; }
  });

  var totals = growth.map(function (g) { return g.input + g.cached + g.output + g.reasoning; });
  var maxY = Math.max.apply(null, totals.concat(limit || [0]));
  var c2d = canvas.getContext("2d");
  var inputColor = cssVar("--chart-input");
  var outputColor = cssVar("--sem-output") || "#3a6ea5";
  var cachedColor = cssVar("--sem-cached") || "#5f6c7e";
  var grad = c2d.createLinearGradient(0, 0, 0, 80);
  grad.addColorStop(0, hexToRgba(inputColor, 0.22));
  grad.addColorStop(1, hexToRgba(inputColor, 0));

  var datasets = [
    {
      label: "Total Context",
      data: totals,
      borderColor: inputColor,
      backgroundColor: grad,
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.35
    },
    {
      label: "New Input",
      data: growth.map(function (g) { return g.input; }),
      borderColor: inputColor,
      borderWidth: 1.25,
      pointRadius: 0,
      tension: 0.35,
      fill: false
    },
    {
      label: "Cached",
      data: growth.map(function (g) { return g.cached; }),
      borderColor: cachedColor,
      borderWidth: 1.25,
      pointRadius: 0,
      tension: 0.35,
      borderDash: [5, 3],
      fill: false
    },
    {
      label: "Output",
      data: growth.map(function (g) { return g.output; }),
      borderColor: outputColor,
      borderWidth: 1.25,
      pointRadius: 0,
      tension: 0.35,
      borderDash: [2, 3],
      fill: false
    }
  ];
  if (limit) {
    datasets.push({
      label: "Model Context Limit",
      data: growth.map(function () { return limit; }),
      borderColor: "var(--sem-reasoning)",
      borderWidth: 1,
      pointRadius: 0,
      borderDash: [8, 4],
      fill: false
    });
  }

  ctxState.growthChart = new Chart(canvas, {
    type: "line",
    data: { labels: growth.map(function (_, i) { return i + 1; }), datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 3, color: cssVar("--text-secondary") } },
        tooltip: {
          callbacks: {
            title: function (items) { return items.length ? "Request #" + (items[0].dataIndex + 1) : ""; },
            label: function (item) {
              var v = item.parsed.y;
              if (item.datasetIndex === datasets.length - 1 && limit) {
                return " " + item.dataset.label + ": " + formatTokens(v);
              }
              return " " + item.dataset.label + ": " + formatTokens(v);
            },
            afterBody: function (items) {
              if (!items.length) return "";
              var g = growth[items[0].dataIndex];
              var t = g.input + g.cached + g.output + g.reasoning;
              var line = "";
              if (limit) line += "Window Usage: " + (t / limit * 100).toFixed(1) + "%";
              return line;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Request", color: cssVar("--chart-axis"), font: { size: 10 } },
          ticks: { color: cssVar("--chart-axis"), maxTicksLimit: 12, callback: function (v) { return "R" + v; } },
          grid: { display: false }
        },
        y: {
          suggestedMax: Math.ceil(maxY * 1.08 / 10000) * 10000,
          ticks: { color: cssVar("--chart-axis"), callback: function (v) { return formatTokens(v); } },
          grid: { color: cssVar("--chart-grid") }
        }
      }
    }
  });
  chartRegistry.contextGrowth = ctxState.growthChart;
}
