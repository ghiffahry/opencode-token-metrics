/* Daily budget widget: today's token spend vs a daily target, projection,
   and a 14-day calendar history (Asia/Jakarta day boundaries). */

import { state, chartRegistry } from "../core/state.js";
import { $, nf, esc, clamp, cssVar, hexToRgba, formatTokens, icons } from "../core/utils.js";

var budgetChart = null;

export function renderBudget(snap) {
  if (!snap || !snap.config) return;
  var target = snap.config.target || 0;
  var pct = clamp(snap.pct || 0, 0, 100);
  var over = snap.today.tokens > target;

  $("#budgetTarget").textContent = formatTokens(target);
  $("#budgetTarget").title = snap.config.source === "configured"
    ? "Configured via TOKENMETRICS_DAILY_BUDGET"
    : snap.config.note || "Default estimate - set TOKENMETRICS_DAILY_BUDGET to pin a value";

  $("#budgetUsed").textContent = formatTokens(snap.today.tokens);
  $("#budgetLimit").textContent = formatTokens(target);
  $("#budgetRemaining").textContent = formatTokens(snap.remaining);
  var sub = $("#budgetSub");
  if (sub) {
    sub.textContent = "Usage today vs. configured target · " + snap.today.requests + " requests · " +
      formatTokens(snap.today.input) + " new input · " +
      formatTokens(snap.today.cacheRead) + " cached · " +
      formatTokens(snap.today.output) + " output";
  }
  var fill = $("#budgetBar");
  if (fill) {
    fill.style.width = (over ? 100 : pct).toFixed(1) + "%";
    fill.classList.toggle("is-over", over);
    fill.classList.toggle("is-warn", !over && pct >= 75);
    var bar = fill.parentElement;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
  $("#budgetPct").textContent = (over ? ">" : "") + pct.toFixed(1) + "%";
  $("#budgetPct").classList.toggle("is-danger-text", over);
  var badge = $("#budgetBadge");
  if (badge) {
    badge.textContent = over ? "Over budget" : "OK";
    badge.classList.toggle("status-badge--danger", over);
    badge.classList.toggle("status-badge--ok", !over);
  }

  var proj = $("#budgetProjection");
  if (proj) {
    var projPct = target > 0 ? ((snap.projectedToday || 0) / target) * 100 : 0;
    proj.textContent = formatTokens(snap.projectedToday || 0);
    proj.className = projPct > 100 ? "budget-projection is-danger-text" : "budget-projection";
    proj.title = projPct > 100
      ? "Projected " + projPct.toFixed(0) + "% of daily budget"
      : "Extrapolated end-of-day usage (" + projPct.toFixed(0) + "% of budget)";
  }

  renderBudgetChart(snap);
  renderBudgetTable(snap);
}

function renderBudgetChart(snap) {
  var canvas = $("#budgetChart");
  if (!canvas || !window.Chart) return;
  if (budgetChart) { budgetChart.destroy(); budgetChart = null; }
  var hist = snap.history || [];
  var labels = hist.map(function (h) { return h.label; });
  var data = hist.map(function (h) { return h.tokens; });
  var budgetColor = cssVar("--ctx-budget") || "#e0b341";
  var barColor = cssVar("--chart-bar");
  var colors = data.map(function (_, i) {
    var c = hist[i].over ? (cssVar("--chart-danger") || "#e5534b") : barColor;
    return i === hist.length - 1 ? hexToRgba(c, 1) : hexToRgba(c, 0.55);
  });
  var target = snap.config.target || 0;
  var budgetLine = data.map(function () { return target; });

  budgetChart = new Chart(canvas, {
    data: {
      labels: labels,
      datasets: [
        {
          type: "bar",
          label: "Tokens",
          data: data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 3
        },
        {
          type: "line",
          label: "Budget",
          data: budgetLine,
          borderColor: budgetColor,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 3, color: cssVar("--text-secondary") } },
        tooltip: {
          callbacks: {
            label: function (c) {
              if (c.dataset.type === "line") return "Budget " + formatTokens(c.parsed.y);
              var h = hist[c.dataIndex];
              return formatTokens(h.tokens) + " · " + h.requests + " requests" +
                (h.over ? " · over budget" : "");
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: cssVar("--chart-axis"), maxRotation: 0, autoSkip: true, maxTicksLimit: 14 },
          grid: { display: false }
        },
        y: {
          ticks: { color: cssVar("--chart-axis"), callback: function (v) { return formatTokens(v); } },
          grid: { color: cssVar("--chart-grid") }
        }
      }
    }
  });
  chartRegistry.budget = budgetChart;
}

function renderBudgetTable(snap) {
  var body = $("#budgetBody");
  if (!body) return;
  var hist = snap.history || [];
  body.innerHTML = hist.slice().reverse().map(function (h) {
    var delta = h.over ? "+" + formatTokens(h.tokens - h.budget) : formatTokens(h.remaining);
    return (
      "<tr>" +
      '<td class="cell-primary">' + esc(h.label) + '<span class="cell-secondary"> ' + h.date + "</span></td>" +
      '<td class="numeric">' + nf.format(h.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(h.input) + "</td>" +
      '<td class="numeric">' + formatTokens(h.output) + "</td>" +
      '<td class="numeric">' + formatTokens(h.tokens) + "</td>" +
      '<td class="numeric">' + formatTokens(h.budget) + "</td>" +
      '<td class="numeric ' + (h.over ? "is-danger-text" : "") + '">' + delta + "</td>" +
      '<td><span class="badge ' + (h.over ? "badge--over" : "badge--ok") + '">' +
      (h.over ? "Over" : "OK") + "</span></td>" +
      "</tr>"
    );
  }).join("");
  icons();
}
