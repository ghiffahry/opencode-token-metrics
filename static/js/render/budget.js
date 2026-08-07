/* Daily budget widget: today's token spend vs a daily target, projection,
   burn rate and a 14-day calendar history (Asia/Jakarta day boundaries).
   Percentages are shown raw — never clamped to 100%. */

import { state, chartRegistry } from "../core/state.js";
import { $, nf, esc, clamp, cssVar, hexToRgba, formatTokens, formatTime, icons } from "../core/utils.js";

var budgetChart = null;

function burnRate(snap, nowMs) {
  var used = snap.today.tokens || 0;
  if (used <= 0 || !nowMs) return 0;
  var d = new Date(nowMs);
  var startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var hours = Math.max((nowMs - startOfDay) / 3600000, 0.1);
  return used / hours;
}

function exceededAt(snap, nowMs) {
  var target = snap.config.target || 0;
  var used = snap.today.tokens || 0;
  var rate = burnRate(snap, nowMs);
  if (target <= 0 || rate <= 0) return null;
  if (used > target) return { at: 0, label: "Exceeded — target passed earlier today" };
  var remaining = target - used;
  var minutes = Math.floor((remaining / rate) * 60);
  if (minutes >= 24 * 60) return { at: minutes, label: "No target breach within 24h" };
  var d = new Date(nowMs + minutes * 60000);
  return { at: minutes, label: "Target exceeded at " + formatTime(d) };
}

export function renderBudget(snap) {
  if (!snap || !snap.config) return;
  var target = snap.config.target || 0;
  var used = snap.today.tokens || 0;
  var pctRaw = target > 0 ? (used / target) * 100 : 0;
  var over = used > target;

  $("#budgetTarget").textContent = formatTokens(target);
  $("#budgetTarget").title = snap.config.source === "configured"
    ? "Configured via TOKENMETRICS_DAILY_BUDGET"
    : snap.config.note || "Default estimate - set TOKENMETRICS_DAILY_BUDGET to pin a value";
  var targetMeta = $("#budgetTargetMeta");
  if (targetMeta) {
    targetMeta.textContent = snap.config.source === "configured"
      ? "Configured daily target"
      : "Estimated target (set TOKENMETRICS_DAILY_BUDGET to pin)";
  }

  $("#budgetUsed").textContent = formatTokens(used);
  $("#budgetUsed").title = nf.format(used) + " tokens today";
  $("#budgetLimit").textContent = formatTokens(target);
  $("#budgetRemaining").textContent = formatTokens(Math.max(0, snap.remaining || 0));
  var sub = $("#budgetSub");
  if (sub) {
    sub.textContent = "Usage today vs. configured target · " + snap.today.requests + " requests · " +
      formatTokens(snap.today.input) + " new input · " +
      formatTokens(snap.today.cacheRead) + " cached · " +
      formatTokens(snap.today.output) + " output";
  }
  var fill = $("#budgetBar");
  if (fill) {
    fill.style.width = clamp(pctRaw, 0, 100).toFixed(1) + "%";
    fill.classList.toggle("is-over", over);
    fill.classList.toggle("is-warn", !over && pctRaw >= 75);
    var bar = fill.parentElement;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pctRaw)));
  }
  $("#budgetPct").textContent = pctRaw.toFixed(1) + "%";
  $("#budgetPct").classList.toggle("is-danger-text", over);
  var badge = $("#budgetBadge");
  if (badge) {
    badge.textContent = over ? "Exceeded" : "OK";
    badge.classList.toggle("status-badge--danger", over);
    badge.classList.toggle("status-badge--ok", !over);
  }
  var overEl = $("#budgetOver");
  if (overEl) {
    overEl.hidden = !over;
    if (over) overEl.textContent = nf.format(used - target) + " over configured target";
  }

  var nowMs = Date.now();
  var burn = $("#budgetBurn");
  if (burn) {
    burn.hidden = false;
    burn.innerHTML =
      '<span class="budget-burn__item">Burn rate <strong>' + formatTokens(Math.round(burnRate(snap, nowMs))) + "/h</strong></span>" +
      '<span class="budget-burn__item">Est. excess <strong>' + formatTokens(Math.max(0, (snap.projectedToday || 0) - target)) + "</strong></span>";
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
  var projMeta = $("#budgetProjectionMeta");
  if (projMeta) {
    projMeta.textContent = projPct > 100
      ? "Projected " + projPct.toFixed(0) + "% of daily target"
      : "End-of-day projection at current burn rate";
  }
  var timing = $("#budgetTiming");
  if (timing) {
    var ex = exceededAt(snap, nowMs);
    if (ex) {
      timing.innerHTML = '<span class="budget-timing__item ' + (used > target ? "is-danger-text" : "") + '">' + ex.label + "</span>";
    } else {
      timing.innerHTML = "";
    }
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
