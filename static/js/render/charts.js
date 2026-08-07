/* Chart.js renders: bar charts, usage line, stages, realtime stream init. */

import { state, chartRegistry } from "../core/state.js";
import { $, nf, icons, cssVar, formatTokens } from "../core/utils.js";

export function chartDefaults() {
  return {
    color: cssVar("--text-secondary"),
    borderColor: cssVar("--border"),
    font: { family: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', size: 12 }
  };
}

export function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: {
        labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, color: cssVar("--text-secondary") }
      },
      tooltip: {
        backgroundColor: cssVar("--chart-tooltip-bg"),
        borderColor: cssVar("--border"),
        borderWidth: 1,
        titleColor: cssVar("--text-primary"),
        bodyColor: cssVar("--text-secondary"),
        padding: 12,
        cornerRadius: 10,
        displayColors: true
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: cssVar("--border") },
        ticks: { color: cssVar("--chart-axis"), maxRotation: 45, font: { size: 11 } }
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: cssVar("--chart-grid") },
        ticks: { color: cssVar("--chart-axis"), font: { size: 11 }, callback: function (v) { return formatTokens(v); } }
      }
    }
  };
}

function setChartEmpty(canvas, hasData) {
  var wrap = canvas.closest(".chart-wrap");
  var card = canvas.closest(".card");
  var existing = card && $(".chart-empty", card);
  if (hasData) {
    if (existing) existing.remove();
    canvas.style.display = "";
  } else {
    if (!existing && card) {
      var div = document.createElement("div");
      div.className = "empty-state chart-empty";
      div.innerHTML = '<i data-lucide="bar-chart-3"></i>' +
        '<span class="empty-state__title">No data available</span>' +
        '<span class="empty-state__sub">No API activity was recorded during this period.</span>';
      card.appendChild(div);
      icons();
    }
    canvas.style.display = "none";
  }
}

export function renderBarCharts(view) {
  var list = view.models.slice();
  if (state.modelFilter !== "all") list = list.filter(function (m) { return m.id === state.modelFilter; });
  var labels = list.map(function (m) { return m.short; });

  setChartEmpty($("#chartGeneration"), list.length > 0);
  setChartEmpty($("#chartApi"), list.length > 0);

  if (chartRegistry.generation) { chartRegistry.generation.destroy(); chartRegistry.generation = null; }
  if (chartRegistry.api) { chartRegistry.api.destroy(); chartRegistry.api = null; }
  if (!list.length) return;

  var wrapGen = $("#chartGeneration").closest(".chart-wrap");
  var wrapApi = $("#chartApi").closest(".chart-wrap");
  wrapGen.style.height = "240px";
  wrapApi.style.height = "240px";

  var opt = baseOptions();
  opt.plugins.legend.display = false;
  opt.scales.x.ticks.callback = function (v, i) { return labels.length > 6 && i % 2 ? "" : labels[i]; };

  chartRegistry.generation = new Chart($("#chartGeneration"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Input tokens",
        data: list.map(function (m) { return m.input; }),
        backgroundColor: cssVar("--chart-input"),
        borderColor: cssVar("--chart-input-border"),
        borderWidth: 1,
        borderSkipped: false,
        borderRadius: 5,
        maxBarThickness: 46
      }]
    },
    options: Object.assign({}, opt, {
      plugins: Object.assign({}, opt.plugins, {
        tooltip: Object.assign({}, opt.plugins.tooltip, {
          callbacks: { label: function (c) { return " " + formatTokens(c.parsed.y) + " tokens"; } }
        })
      })
    })
  });

  chartRegistry.api = new Chart($("#chartApi"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Output tokens",
        data: list.map(function (m) { return m.output; }),
        backgroundColor: cssVar("--chart-output"),
        borderColor: cssVar("--chart-output-border"),
        borderWidth: 1,
        borderSkipped: false,
        borderRadius: 5,
        maxBarThickness: 46
      }]
    },
    options: Object.assign({}, opt, {
      plugins: Object.assign({}, opt.plugins, {
        tooltip: Object.assign({}, opt.plugins.tooltip, {
          callbacks: { label: function (c) { return " " + formatTokens(c.parsed.y) + " tokens"; } }
        })
      })
    })
  });
}

export function renderUsageChart(view) {
  if (chartRegistry.usage) { chartRegistry.usage.destroy(); chartRegistry.usage = null; }
  var buckets = view.chartBuckets;
  setChartEmpty($("#chartUsage"), buckets.length > 0);
  if (!buckets.length) return;

  var wrap = $("#chartUsage").closest(".chart-wrap");
  wrap.style.height = "280px";

  var opt = baseOptions();
  opt.scales.x.ticks.maxRotation = 45;
  opt.plugins.tooltip.callbacks = {
    label: function (c) {
      var d = buckets[c.dataIndex];
      return [" Input: " + formatTokens(d.input) + " tokens", " Output: " + formatTokens(d.output) + " tokens"];
    }
  };

  chartRegistry.usage = new Chart($("#chartUsage"), {
    type: "line",
    data: {
      labels: buckets.map(function (b) { return b.label; }),
      datasets: [
        {
          label: "Input", data: buckets.map(function (b) { return b.input; }),
          borderColor: cssVar("--chart-input"), backgroundColor: cssVar("--chart-input"),
          borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 4, tension: 0.35, fill: false
        },
        {
          label: "Output", data: buckets.map(function (b) { return b.output; }),
          borderColor: cssVar("--chart-output"), backgroundColor: cssVar("--chart-output"),
          borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 4, tension: 0.35, fill: false
        }
      ]
    },
    options: opt
  });

  var hourly = view.range === "today" || view.range === "24h";
  $("#usageMeta").textContent = view.range === "today" ? "Since 00:00" : view.range === "24h" ? "Last 24 hours" : view.range === "90d" ? "13 weeks" : view.rangeLabel;
  $("#usageSub").textContent = hourly ? "Hourly" : view.range === "90d" ? "Weekly" : "Daily";
}

export function renderStagesChart(view) {
  if (chartRegistry.stages) { chartRegistry.stages.destroy(); chartRegistry.stages = null; }
  var stages = view.stages.slice();
  setChartEmpty($("#chartStages"), stages.length > 0);
  if (!stages.length) return;

  var wrap = $("#chartStages").closest(".chart-wrap");
  wrap.style.height = "300px";

  var opt = baseOptions();
  opt.indexAxis = "y";
  opt.scales = {
    x: {
      beginAtZero: true, stacked: true, grid: { color: cssVar("--chart-grid") },
      ticks: { color: cssVar("--text-tertiary"), font: { size: 11 }, callback: function (v) { return formatTokens(v); } }
    },
    y: { stacked: true, grid: { display: false }, ticks: { color: cssVar("--text-tertiary"), font: { size: 11 } } }
  };
  opt.plugins.tooltip.callbacks = {
    label: function (c) {
      var d = stages[c.dataIndex];
      var prefix = c.dataset.label;
      var val = c.datasetIndex === 0 ? d.input : d.output;
      return " " + prefix + ": " + formatTokens(val) + " tokens";
    }
  };

  chartRegistry.stages = new Chart($("#chartStages"), {
    type: "bar",
    data: {
      labels: stages.map(function (s) { return s.name; }),
      datasets: [
        {
          label: "Input", data: stages.map(function (s) { return s.input; }),
          backgroundColor: cssVar("--chart-input"), borderColor: cssVar("--chart-input-border"),
          borderWidth: 1, borderSkipped: false, borderRadius: 3, maxBarThickness: 20
        },
        {
          label: "Output", data: stages.map(function (s) { return s.output; }),
          backgroundColor: cssVar("--chart-output"), borderColor: cssVar("--chart-output-border"),
          borderWidth: 1, borderSkipped: false, borderRadius: 3, maxBarThickness: 20
        }
      ]
    },
    options: opt
  });
}

export function initRealtimeChart() {
  if (chartRegistry.realtime) return;
  var wrap = $("#realtimeChart").closest(".chart-wrap");
  wrap.style.height = "220px";
  var opt = baseOptions();
  opt.animation = false;
  opt.plugins.legend.display = true;
  opt.plugins.tooltip.enabled = true;
  opt.plugins.tooltip.callbacks = {
    label: function (c) {
      return " " + c.dataset.label + ": " + nf.format(c.parsed.y) + " tokens";
    }
  };
  opt.scales.x.ticks.maxRotation = 0;
  opt.scales.x.ticks.autoSkip = true;
  opt.scales.x.ticks.maxTicksLimit = 8;
  opt.scales.y.ticks.callback = function (v) { return formatTokens(v); };

  chartRegistry.realtime = new Chart($("#realtimeChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Input", data: [],
          borderColor: cssVar("--chart-input"), backgroundColor: cssVar("--chart-input"),
          borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false
        },
        {
          label: "Output", data: [],
          borderColor: cssVar("--chart-output"), backgroundColor: cssVar("--chart-output"),
          borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false
        }
      ]
    },
    options: opt
  });
}

function trimToWindow() {
  var c = chartRegistry.realtime;
  if (!c) return;
  var max = state.liveWindow;
  if (c.data.labels.length > max) {
    c.data.labels = c.data.labels.slice(-max);
    c.data.datasets[0].data = c.data.datasets[0].data.slice(-max);
    c.data.datasets[1].data = c.data.datasets[1].data.slice(-max);
  }
  c.update("none");
}

export function setStreamWindow(seconds) {
  state.liveWindow = seconds;
  trimToWindow();
}
