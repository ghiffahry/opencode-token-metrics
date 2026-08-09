/* Token Quota widget: estimated quota window (NOT a calendar day) with
   usage, burn rate, hourly burn sparkline, reset countdown, projection and
   time-to-exhaustion. The window is estimated (never exact provider timing);
   only the SERIES of real consumed tokens feeds the sparkline - no fabricated
   values. Calendar-day usage stays separate (chart + table). */

import { state, chartRegistry } from "../core/state.js";
import { $, nf, esc, cssVar, hexToRgba, clamp, formatTokens, pad2 } from "../core/utils.js";

var burnChart = null;
var countdownTimer = null;

function fmtClock(ms) {
  if (!ms) return "…";
  var d = new Date(ms);
  var now = new Date();
  var prefix = d.toDateString() === now.toDateString()
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " ";
  return prefix + d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var d = Math.floor(s / 86400);
  s -= d * 86400;
  var h = Math.floor(s / 3600);
  s -= h * 3600;
  var m = Math.floor(s / 60);
  if (d > 0) return d + "d " + h + "h";
  return pad2(h) + "h " + pad2(m) + "m";
}

/* Dashboard interpretation thresholds (NOT provider rules). */
function tierFor(w) {
  if (w.used > 0 && w.limit > 0 && w.used >= w.limit) return { cls: "danger", label: "EXHAUSTION RISK" };
  if (w.willExhaustBeforeReset) return { cls: "danger", label: "EXHAUSTION RISK" };
  var pct = w.projectedPct;
  if (pct == null) return { cls: "", label: "HEALTHY" };
  if (pct >= 90) return { cls: "danger", label: "CRITICAL" };
  if (pct >= 75) return { cls: "warning", label: "HIGH" };
  if (pct >= 50) return { cls: "warning", label: "WATCH" };
  return { cls: "success", label: "HEALTHY" };
}

/* Exposure: green = safe until reset, amber = approaching, red = exhaustion likely. */
function exposure(w) {
  if (w.limit > 0 && w.used >= w.limit) return { cls: "danger", text: "Quota exhausted" };
  if (w.willExhaustBeforeReset) return { cls: "danger", text: "May exhaust before reset" };
  var pct = w.projectedPct;
  if (pct == null) return { cls: "", text: "Exposure unknown" };
  if (pct >= 75) return { cls: "warning", text: "Approaching quota limit" };
  return { cls: "success", text: "Safe until reset" };
}

function setDot(el, cls) {
  if (!el) return;
  el.className = "q-status__dot" + (cls ? " is-" + cls : "");
}

function fmtRemain(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600);
  s -= h * 3600;
  var m = Math.floor(s / 60);
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

function updateTimelineHint(resetAt) {
  var el = $("#quotaTimelineHint");
  if (!el) return;
  el.textContent = resetAt ? fmtRemain(resetAt - Date.now()) + " lagi sampai reset" : "";
}

function renderCountdown(resetAt) {
  var el = $("#quotaResetCount");
  if (!el) return;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  function tick() {
    el.textContent = resetAt ? fmtDuration(resetAt - Date.now()) : "…";
    updateTimelineHint(resetAt);
  }
  tick();
  countdownTimer = setInterval(tick, 3000);
}

function renderTimeline(w) {
  var tl = $("#quotaTimeline");
  if (!tl) return;
  tl.hidden = !w.start;
  if (!w.start) return;
  $("#quotaTimelineStart").textContent = fmtClock(w.start);
  $("#quotaTimelineEnd").textContent = fmtClock(w.end);
  $("#quotaTimelineNowTime").textContent = fmtClock(Date.now());
  var frac = w.hours > 0 ? clamp((w.elapsedHours || 0) / w.hours, 0, 1) : 0;
  var cell = $("#quotaTimelineNowCell");
  if (cell) cell.style.left = (frac * 100).toFixed(1) + "%";
  var marker = $("#quotaTimelineMarker");
  if (marker) marker.style.left = (frac * 100).toFixed(1) + "%";
  var fill = $("#quotaTimelineFill");
  if (fill) fill.style.width = (frac * 100).toFixed(1) + "%";
  updateTimelineHint(w.end);
}

function renderBurnChart(w) {
  var canvas = $("#burnChart");
  var empty = $("#burnEmpty");
  if (!canvas || !window.Chart) return;
  if (burnChart) { burnChart.destroy(); burnChart = null; }
  var series = w.series || [];
  if (series.length < 2) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  var base = cssVar("--chart-input");
  var ctx = canvas.getContext("2d");
  var h = canvas.clientHeight || 88;
  var grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(base, 0.32));
  grad.addColorStop(1, hexToRgba(base, 0));

  burnChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: series.map(function (s) { return s.label; }),
      datasets: [{
        label: "Tokens",
        data: series.map(function (s) { return s.tokens; }),
        borderColor: base,
        backgroundColor: grad,
        borderWidth: 1.6,
        pointRadius: 0,
        pointHitRadius: 6,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) {
              var i = items.length ? items[0].dataIndex : -1;
              return i >= 0 ? series[i].label : "";
            },
            label: function (c) {
              var s = series[c.dataIndex];
              return formatTokens(s.tokens) + " · " + nf.format(s.requests) + " requests";
            }
          }
        }
      },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });
  chartRegistry.burn = burnChart;
}

function renderInsight(w, e) {
  var box = $("#quotaInsight");
  if (!box) return;
  if (!w.used) { box.hidden = true; return; }
  box.hidden = false;
  $("#insightStatusText").textContent = e.text;
  var st = $("#insightStatus");
  if (st) st.className = "quota-insight__status" + (e.cls ? " is-" + e.cls : "");
  var dot = $("#insightStatus .q-status__dot");
  if (dot) setDot(dot, e.cls);
  var parts = [
    formatTokens(w.used) + " used",
    formatTokens(Math.max(0, w.remaining)) + " remaining"
  ];
  if (w.projectedAtReset != null) parts.push(formatTokens(w.projectedAtReset) + " projected at reset");
  $("#insightSummary").textContent = parts.join(" · ");
}

function renderModelMeta(w) {
  var el = $("#quotaModelMeta");
  if (!el) return;
  var filter = state.modelFilter;
  if (filter && filter !== "all") {
    el.textContent = "Model " + filter + " · " + formatTokens(w.limit || 0) + " / " + (w.hours || 14) + "h";
  } else {
    el.textContent = "Quota varies by model";
  }
  el.hidden = false;
}

export function renderBudget(snap) {
  if (!snap || !snap.window) return;
  var w = snap.window;
  var limit = w.limit || 0;
  var used = w.used || 0;
  var over = used > limit;
  var pctRaw = limit > 0 ? (used / limit) * 100 : 0;
  var t = tierFor(w);
  var e = exposure(w);

  /* ---- header ---- */
  var sub = $("#budgetSub");
  if (sub) sub.textContent = formatTokens(limit) + " tokens · " + (w.hours || 14) + "h quota window";
  renderModelMeta(w);

  /* ---- Card 1: Quota ---- */
  var ql = $("#quotaLimit");
  if (ql) {
    ql.textContent = formatTokens(limit);
    ql.classList.toggle("is-danger-text", over);
  }
  var qls = $("#quotaLimitSub");
  if (qls) qls.textContent = (w.hours || 14) + "h";
  $("#quotaUsed").textContent = formatTokens(used);
  $("#quotaUsed").title = nf.format(used);
  $("#quotaRemaining").textContent = over
    ? "0 (" + nf.format(used - limit) + " over)"
    : formatTokens(limit - used);
  $("#quotaRemaining").classList.toggle("is-danger-text", over);
  $("#quotaUtilPct").textContent = over
    ? (pctRaw.toFixed(1) + "% · over") : pctRaw.toFixed(1) + "%";
  fill("#quotaBar", pctRaw, over);
  $("#quotaSource").textContent = w.source === "configured"
    ? "Configured (TOKENMETRICS_QUOTA_TOKENS)"
    : "Estimated free-tier limit";

  /* ---- Card 2: Current Usage ---- */
  $("#budgetUsed").textContent = formatTokens(used);
  $("#budgetLimit").textContent = formatTokens(limit);
  var uc = $("#quotaStatusPill");
  if (uc) {
    uc.hidden = false;
    uc.className = "q-status" + (t.cls ? " is-" + t.cls : "");
    uc.title = "Projected " + (w.projectedPct != null ? w.projectedPct.toFixed(1) + "% of quota at reset" : "no projection yet")
      + " · tiers are dashboard thresholds (WATCH ≥50%, HIGH ≥75%, CRITICAL ≥90%)";
    $("#quotaStatusText").textContent = t.label;
  }
  var bp = $("#budgetPct");
  if (bp) bp.textContent = pctRaw.toFixed(1) + "% used";
  fill("#budgetBar", pctRaw, over);
  var burn = $("#quotaBurn");
  if (burn) burn.textContent = w.burnRate != null ? formatTokens(w.burnRate) + "/h" : "…";
  var burnRate = $("#quotaBurnRate");
  if (burnRate) burnRate.textContent = w.burnRate != null ? formatTokens(w.burnRate) + "/h" : "…";
  $("#quotaRequests").textContent = nf.format(w.requests) + " / " + nf.format(w.requestLimit || 0);
  renderBurnChart(w);

  /* ---- Card 3: Reset & Projection ---- */
  $("#quotaResetNext").textContent = fmtClock(w.resetAt) + " WIB";
  renderCountdown(w.resetAt);
  var proj = $("#budgetProjection");
  if (proj) {
    if (w.projectedAtReset != null) {
      proj.textContent = formatTokens(w.projectedAtReset);
      proj.title = "Projected " + (w.projectedPct || 0).toFixed(1) + "% of quota at reset";
    } else {
      proj.textContent = "…";
      proj.removeAttribute("title");
    }
  }
  var pmeta = $("#budgetProjectionMeta");
  if (pmeta) pmeta.textContent = w.projectedPct != null
    ? (w.projectedPct.toFixed(1) + "% of quota") : "Insufficient data for a projection";
  fill("#projBar", w.projectedPct != null ? w.projectedPct : 0, false, w.projectedPct != null);
  $("#cmpCurrent").textContent = formatTokens(used);
  $("#cmpProjected").textContent = w.projectedAtReset != null ? formatTokens(w.projectedAtReset) : "…";
  $("#cmpGrowth").textContent = w.projectedAtReset != null
    ? "+" + formatTokens(Math.max(0, w.projectedAtReset - used)) : "…";
  var exp = $("#quotaExposure");
  if (exp) {
    exp.hidden = false;
    exp.className = "q-exposure is-" + (e.cls || "info");
    $("#exposureText").textContent = e.text;
  }

  renderTimeline(w);
  renderInsight(w, e);
  renderBudgetChart(snap);
  renderBudgetTable(snap);
}

function fill(id, pctRaw, over, known) {
  var bar = $(id);
  if (!bar) return;
  bar.style.width = clamp(pctRaw, 0, 100).toFixed(1) + "%";
  bar.className = "progress__bar" +
    (over ? " is-danger" : (known === false ? "" : (pctRaw >= 80 ? " is-warning" : "")));
  var wrap = bar.parentElement;
  if (wrap) wrap.setAttribute("aria-valuenow", String(Math.round(pctRaw)));
}

function renderBudgetChart(snap) {
  var canvas = $("#budgetChart");
  if (!canvas || !window.Chart) return;
  if (chartRegistry.budget) {
    chartRegistry.budget.destroy();
    chartRegistry.budget = null;
  }
  var hist = snap.history || [];
  var barColor = cssVar("--chart-bar") || "#64748b";
  var colors = hist.map(function (_, i) {
    return i === hist.length - 1 ? hexToRgba(barColor, 1) : hexToRgba(barColor, 0.55);
  });
  var chart = new Chart(canvas, {
    data: {
      labels: hist.map(function (h) { return h.label; }),
      datasets: [{
        type: "bar",
        label: "Tokens",
        data: hist.map(function (h) { return h.tokens; }),
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (c) {
              var h = hist[c.dataIndex];
              return formatTokens(h.tokens) + " · " + h.requests + " requests";
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
  chartRegistry.budget = chart;
}

function renderBudgetTable(snap) {
  var body = $("#budgetBody");
  if (!body) return;
  var hist = snap.history || [];
  body.innerHTML = hist.slice().reverse().map(function (h) {
    return (
      "<tr>" +
      '<td class="cell-primary">' + esc(h.label) + '<span class="cell-secondary"> ' + h.date + "</span></td>" +
      '<td class="numeric">' + nf.format(h.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(h.input) + "</td>" +
      '<td class="numeric">' + formatTokens(h.output) + "</td>" +
      '<td class="numeric"><strong>' + formatTokens(h.tokens) + "</strong></td>" +
      "</tr>"
    );
  }).join("");
}