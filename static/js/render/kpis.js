/* KPI metric cards + sparkline charts. */

import { state, chartRegistry } from "../core/state.js";
import { $, $all, nf, icons, cssVar, hexToRgba, formatTokens, formatLatency } from "../core/utils.js";

function deltaInfo(cur, prev, invert) {
  if (!prev) return { pct: 0, dir: "flat", good: true };
  var pct = ((cur - prev) / prev) * 100;
  var dir = Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  var good = invert ? pct < 0 : pct > 0;
  if (dir === "flat") good = true;
  return { pct: pct, dir: dir, good: good };
}

function deltaBadge(d) {
  if (!d) return '<span class="metric-card__delta metric-card__delta--flat"><i data-lucide="minus"></i>0%</span>';
  var cls = d.dir === "flat" ? "flat" : d.good ? "up" : "down";
  var icon = d.dir === "flat" ? "minus" : d.dir === "up" ? "arrow-up-right" : "arrow-down-right";
  var text = d.dir === "flat" ? "0%" : (d.pct > 0 ? "+" : "") + d.pct.toFixed(1) + "%";
  return '<span class="metric-card__delta metric-card__delta--' + cls + '"><i data-lucide="' + icon + '"></i>' + text + "</span>";
}

export function renderKpis(view) {
  var prev = view.prev || {};
  var defs = [
    {
      key: "tokens", label: "Total Tokens", icon: "coins",
      value: formatTokens(view.total),
      delta: deltaInfo(view.total, prev.total, false), spark: "tokens"
    },
    {
      key: "requests", label: "Requests", icon: "send",
      value: nf.format(view.requests),
      delta: deltaInfo(view.requests, prev.requests, false), spark: "requests"
    },
    {
      key: "success", label: "Success Rate", icon: "badge-check",
      value: view.successRate.toFixed(2) + "%",
      delta: (function () {
        var base = prev.successRate;
        var diff = base ? view.successRate - base : 0;
        var dir = Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
        return { pct: diff, dir: dir, good: diff >= 0 };
      })()
    },
    {
      key: "latency", label: "Avg Latency", icon: "timer",
      value: formatLatency(view.latency),
      delta: deltaInfo(view.latency, prev.latency, true)
    }
  ];

  var html = defs.map(function (d) {
    var spark = d.spark
      ? '<div class="metric-card__spark"><canvas data-kpi="' + d.key + '"></canvas></div>'
      : "";
    return (
      '<article class="card metric-card">' +
      '<div class="metric-card__top">' +
      '<span class="metric-card__label">' + d.label + '</span>' +
      '<span class="metric-card__icon"><i data-lucide="' + d.icon + '"></i></span>' +
      "</div>" +
      '<span class="metric-card__value">' + d.value + "</span>" +
      deltaBadge(d.delta) +
      spark +
      "</article>"
    );
  }).join("");

  $("#kpiGrid").innerHTML = html;
  icons();
  renderSparks(view);
}

function sparkSeries(view, key) {
  var buckets = view.buckets;
  if (key === "tokens") return buckets.map(function (b) { return b.input + b.output; });
  return buckets.map(function (b) { return b.requests; });
}

export function renderSparks(view) {
  Object.keys(chartRegistry.sparks).forEach(function (k) {
    if (chartRegistry.sparks[k]) { chartRegistry.sparks[k].destroy(); delete chartRegistry.sparks[k]; }
  });
  $all("#kpiGrid [data-kpi]").forEach(function (canvas) {
    var key = canvas.getAttribute("data-kpi");
    var data = sparkSeries(view, key);
    var ctx = canvas.getContext("2d");
    var base = cssVar("--chart-input");
    var gradient = ctx.createLinearGradient(0, 0, 0, 42);
    gradient.addColorStop(0, hexToRgba(base, 0.28));
    gradient.addColorStop(1, hexToRgba(base, 0));
    chartRegistry.sparks[key] = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.map(function (_, i) { return String(i); }),
        datasets: [{
          data: data,
          borderColor: cssVar("--chart-input"),
          backgroundColor: gradient,
          fill: true,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderCapStyle: "round" } }
      }
    });
  });
}
