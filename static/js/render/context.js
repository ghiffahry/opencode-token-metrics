/* Context usage section: current window utilisation, estimated composition,
   breakdown views (model/session/agent/requests) with a details drawer, and
   conversation growth chart.

   All numbers come from the server payload (/api/context_usage). Composition
   is a labelled server-side heuristic (estimated) - this module never
   estimates tokens itself. */

import { state, chartRegistry } from "../core/state.js";
import { $, $all, nf, esc, clamp, cssVar, hexToRgba, formatTokens, formatRelative, formatDateTime, icons } from "../core/utils.js";
import { refreshTooltips } from "../ui/tooltip.js";

var ctxBound = false;
var selectedSession = null;
var ctxGrowthChart = null;
var ctxDrawerOpen = false;

var CATEGORY_LABELS = {
  system_prompt: "System Prompt",
  tool_definitions: "Tool Definitions",
  rules: "Rules",
  skills: "Skills",
  mcp: "MCP",
  conversation: "Conversation",
  retrieved_context: "Retrieved Context",
  workspace_context: "Workspace Context",
  memory: "Memory",
  runtime_context: "Runtime Context"
};

function humanCat(c) {
  return CATEGORY_LABELS[c] || c;
}

function utilClass(pct) {
  if (pct > 90) return "is-critical";
  if (pct >= 75) return "is-warn";
  if (pct >= 50) return "is-mid";
  return "is-ok";
}

function utilTextClass(cls) {
  return cls === "is-warn" ? "text-warn" : cls === "is-critical" ? "is-danger-text" : "";
}

/* ---------------- Context Window ---------------- */

function metricsStrip(L) {
  var items = [
    { cls: "uncached", label: "New Input", value: L.input },
    { cls: "cached", label: "Cached", value: L.cached },
    { cls: "output", label: "Output", value: L.output },
    { cls: "reasoning", label: "Reasoning", value: L.reasoning }
  ];
  return (
    '<div class="ctx-metrics">' +
    items.map(function (m) {
      return (
        '<div class="ctx-metrics__item" title="' + nf.format(m.value) + " tokens\">" +
        '<span class="ctx-metrics__label"><i class="ctx-metrics__dot ctx-metrics__dot--' + m.cls + '"></i>' + m.label + "</span>" +
        '<span class="ctx-metrics__value">' + formatTokens(m.value) + "</span>" +
        "</div>"
      );
    }).join("") +
    "</div>"
  );
}

function peakBlock(snap) {
  var p = snap.peak;
  if (!p) return "";
  var limit = p.contextLimit || 1;
  var pct = clamp((p.total / limit) * 100, 0, 100);
  var cls = utilClass(pct);
  return (
    '<div class="ctx-peak">' +
    '<div class="ctx-peak__head">' +
    '<span class="ctx-peak__title">Peak Context</span>' +
    '<span class="ctx-peak__nums" title="' + nf.format(p.total) + " of " + nf.format(limit) + " tokens\">" +
    formatTokens(p.total) + " / " + formatTokens(limit) + "</span>" +
    '<span class="ctx-peak__pct ' + utilTextClass(cls) + '">' + pct.toFixed(1) + "%</span>" +
    "</div>" +
    '<div class="ctx-peak__bar"><div class="ctx-peak__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
    "</div>"
  );
}

function renderLatest(snap) {
  var el = $("#ctxLatest");
  var empty = $("#ctxLatestEmpty");
  var L = snap.latest;
  if (!L) {
    if (el) el.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  var limit = L.contextLimit || 1;
  var used = L.input + L.cached + L.output + L.reasoning;
  var pctRaw = (used / limit) * 100;
  var over = used > limit;
  var remaining = Math.max(0, limit - used);
  var cls = over ? "is-critical" : utilClass(pctRaw);
  var pctText = over ? "over limit" : pctRaw.toFixed(1) + "% used";

  el.innerHTML =
    '<div class="ctx-win__meta">' +
    '<span class="ctx-win__model">' + esc(L.model.split("/").pop()) + "</span>" +
    '<span class="ctx-win__sep">·</span>' +
    '<span>Latest request</span>' +
    '<span class="ctx-win__sep">·</span>' +
    '<span>' + formatRelative(L.time) + "</span>" +
    "</div>" +
    '<div class="ctx-win__primary">' +
    '<span class="ctx-win__used" title="' + nf.format(used) + " tokens used\">" + formatTokens(used) + "</span>" +
    '<span class="ctx-win__sub">of ' + formatTokens(limit) + " context window</span>" +
    "</div>" +
    '<div class="ctx-win__status">' +
    '<span class="ctx-win__pct ' + utilTextClass(cls) + '">' + pctText + "</span>" +
    '<span class="ctx-win__remain">' + formatTokens(remaining) + " remaining</span>" +
    "</div>" +
    '<div class="ctx-win__bar ' + cls + '" role="img" aria-label="' + pctRaw.toFixed(1) + '% of the context window is used">' +
    '<div class="ctx-win__fill" style="width:' + Math.min(pctRaw, 100).toFixed(1) + '%"></div>' +
    "</div>" +
    metricsStrip(L) +
    peakBlock(snap);
}

/* ---------------- Composition (estimated) ---------------- */

var COMP_GRID = "minmax(130px, 1fr) minmax(160px, 2fr) 80px 60px";

function compositionRowHtml(s, minor) {
  return (
    '<div class="ctx-comp-row">' +
    '<span class="ctx-comp-row__label" title="' + esc(humanCat(s.category)) + '">' + esc(humanCat(s.category)) + "</span>" +
    '<span class="ctx-comp-row__bar"><span class="ctx-comp-row__fill" style="width:' + clamp(s.pct, 0, 100) + '%"></span></span>' +
    '<span class="numeric ctx-comp-row__tokens" title="' + nf.format(s.tokens) + " tokens\">" + formatTokens(s.tokens) + "</span>" +
    '<span class="numeric ctx-comp-row__share">' + s.pct.toFixed(1) + "%</span>" +
    "</div>"
  );
}

function minorRowHtml(minor, tokens, pct) {
  var subRows = minor.map(function (s) {
    return (
      '<div class="ctx-comp-minor__row">' +
      '<span class="ctx-comp-minor__item-label" title="' + esc(humanCat(s.category)) + '">' + esc(humanCat(s.category)) + "</span>" +
      '<span></span>' +
      '<span class="numeric" title="' + nf.format(s.tokens) + " tokens\">" + formatTokens(s.tokens) + "</span>" +
      '<span class="numeric cell-secondary">' + s.pct.toFixed(1) + "%</span>" +
      "</div>"
    );
  }).join("");
  return (
    '<button type="button" class="ctx-comp-minor" aria-expanded="false">' +
    '<span class="ctx-comp-minor__name" title="Minor Context">' +
    '<span class="ctx-comp-minor__chevron"><i data-lucide="chevron-right"></i></span>' +
    '<span class="ctx-comp-minor__label">Minor Context</span>' +
    "</span>" +
    '<span class="ctx-comp-minor__bar" aria-hidden="true"></span>' +
    '<span class="numeric ctx-comp-minor__tokens" title="' + nf.format(tokens) + " tokens\">" + formatTokens(tokens) + "</span>" +
    '<span class="numeric ctx-comp-minor__share">' + pct.toFixed(1) + "%</span>" +
    "</button>" +
    '<div class="ctx-comp-minor__items" hidden>' + subRows + "</div>"
  );
}

function renderComposition(snap) {
  var el = $("#ctxComposition");
  var insight = $("#ctxInsight");
  if (insight) insight.hidden = true;
  var comp = snap.composition;
  if (!comp || !comp.segments.length) {
    if (el) el.innerHTML = '<span class="cell-secondary">Not available for this request.</span>';
    return;
  }
  var segs = comp.segments.slice();
  var major = segs.filter(function (s) { return s.pct >= 1; });
  var minor = segs.filter(function (s) { return s.pct < 1; });
  var minorTokens = minor.reduce(function (a, s) { return a + s.tokens; }, 0);
  var minorPct = minor.reduce(function (a, s) { return a + s.pct; }, 0);

  var rows = major.map(function (s) { return compositionRowHtml(s); });
  if (minor.length) rows.push(minorRowHtml(minor, minorTokens, minorPct));

  el.innerHTML =
    '<div class="ctx-comp__head">' +
    '<span>Source</span><span></span><span class="numeric">Tokens</span><span class="numeric">Share</span>' +
    "</div>" +
    '<div class="ctx-comp__rows">' + rows.join("") + "</div>";
  icons();

  if (insight && segs.length) {
    var top = segs[0];
    var text;
    if (top.pct >= 70) {
      text = humanCat(top.category) + " dominates current context usage.";
    } else if (segs[1]) {
      text = (top.pct + segs[1].pct).toFixed(1) + "% of current context comes from " +
        humanCat(top.category) + " + " + humanCat(segs[1].category) + ".";
    }
    if (text) {
      insight.innerHTML = '<i data-lucide="sparkles"></i><span>' + esc(text) + "</span>";
      insight.hidden = false;
      icons();
    }
  }
}

function bindCompositionControls() {
  var el = $("#ctxComposition");
  var btn = $("#ctxLearnBtn");
  if (el && !el.dataset.bound) {
    el.dataset.bound = "1";
    el.addEventListener("click", function (e) {
      var toggle = e.target.closest(".ctx-comp-minor");
      if (!toggle) return;
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      var items = toggle.nextElementSibling;
      if (items && items.classList.contains("ctx-comp-minor__items")) items.hidden = open;
      icons();
    });
  }
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    var pop = $("#ctxLearnPop");
    function show() {
      var open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      show();
    });
    document.addEventListener("click", function (e) {
      if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) {
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && pop && !pop.hidden) {
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }
}

/* ---------------- Breakdown table ---------------- */

function windowCell(limit, used, pct) {
  if (!limit) return '<span class="cell-secondary">-</span>';
  pct = clamp(pct || (used / limit) * 100, 0, 100);
  var cls = pct > 90 ? "is-danger" : pct >= 75 ? "is-warning" : "";
  return (
    '<span class="ctx" data-tip="' + nf.format(used) + " of " + nf.format(limit) +
    " tokens (" + pct.toFixed(1) + "% of window)\">" +
    '<span class="ctx__bar"><span class="ctx__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__pct ' + (cls === "is-danger" ? "is-danger-text" : cls === "is-warning" ? "text-warn" : "") + '">' +
    pct.toFixed(1) + "%</span>" +
    "</span>"
  );
}

function windowShare(peak, maxPeak) {
  var pct = maxPeak > 0 ? (peak / maxPeak) * 100 : 0;
  return (
    '<span class="ctx" data-tip="' + nf.format(peak) + " tokens · Share of the largest peak in this view\">" +
    '<span class="ctx__bar"><span class="ctx__fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__pct">' + pct.toFixed(0) + "%</span>" +
    "</span>"
  );
}

function bindCtxControls() {
  if (ctxBound) return;
  ctxBound = true;
  var seg = $("#ctxSegmented");
  if (seg) {
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest(".segment-btn");
      if (!btn) return;
      state.contextView = btn.getAttribute("data-ctx-view");
      $all(".segment-btn", seg).forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      selectedSession = null;
      showGrowthEmpty();
      renderBreakdown(state.contextUsage);
    });
  }
  var table = $("#ctxTable");
  if (table) {
    table.addEventListener("click", function (e) {
      var row = e.target.closest("[data-ctx-row]");
      if (!row) return;
      var view = state.contextView;
      if (view === "session") {
        var sid = row.getAttribute("data-session-id");
        selectedSession = sid;
        var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === sid; })[0];
        if (sess) renderContextGrowth(sess);
        $all("#ctxBody tr.is-open").forEach(function (r) { r.classList.remove("is-open"); });
        row.classList.add("is-open");
        openContextDrawer(sess, "session");
      } else if (view === "model" || view === "agent") {
        var key = row.getAttribute("data-ctx-key");
        var item = (state.contextUsage[view === "model" ? "byModel" : "byAgent"] || [])
          .filter(function (g) { return g.id === key; })[0];
        openContextDrawer(item, view);
      }
    });
  }
}

function renderBreakdown(snap) {
  bindCtxControls();
  bindCompositionControls();
  var view = state.contextView || "model";
  var body = $("#ctxBody");
  var empty = $("#ctxEmpty");
  if (!body) return;
  var list = [];

  if (view === "model") {
    list = (snap.byModel || []).map(function (m) {
      return {
        key: m.id,
        name: m.id.split("/").pop(),
        title: m.id,
        requests: m.requests,
        input: m.input,
        cached: m.cached,
        output: m.output,
        reasoning: m.reasoning,
        peak: m.maxTotal,
        limit: m.contextLimit,
        pct: m.pct,
        lastSeen: m.lastSeen,
        sessionId: null
      };
    });
  } else if (view === "session") {
    list = (snap.bySession || []).map(function (s) {
      return {
        key: s.id,
        name: s.title || s.id,
        title: s.id,
        requests: s.requests,
        input: s.input,
        cached: s.cached,
        output: s.output,
        reasoning: s.reasoning,
        peak: s.maxTotal,
        limit: null,
        pct: 0,
        lastSeen: s.lastSeen,
        sessionId: s.id
      };
    });
  } else if (view === "agent") {
    list = (snap.byAgent || []).map(function (a) {
      return {
        key: a.id,
        name: a.id,
        title: a.id,
        requests: a.requests,
        input: a.input,
        cached: a.cached,
        output: a.output,
        reasoning: a.reasoning,
        peak: a.maxTotal,
        limit: null,
        pct: 0,
        lastSeen: a.lastSeen,
        sessionId: null
      };
    });
  } else {
    list = (snap.requests || []).map(function (r) {
      return {
        key: r.id,
        name: String(r.id).slice(0, 8),
        title: r.model,
        requests: 1,
        input: r.input,
        cached: r.cached,
        output: r.output,
        reasoning: r.reasoning,
        peak: r.total,
        limit: r.contextLimit,
        pct: r.pct,
        lastSeen: r.time,
        sessionId: null,
        time: r.time
      };
    });
  }

  if (empty) empty.hidden = list.length > 0;
  var maxPeak = list.reduce(function (a, r) { return Math.max(a, r.peak || 0); }, 0);
  body.innerHTML = list.slice(0, 50).map(function (r) {
    var sessionRow = view === "session" ? ' data-session-id="' + esc(r.sessionId) + '"' : "";
    var keyRow = (view === "model" || view === "agent") ? ' data-ctx-key="' + esc(r.key) + '"' : "";
    var clickable = view !== "requests";
    var windowCellHtml = r.limit
      ? windowCell(r.limit, r.peak, r.pct)
      : windowShare(r.peak, maxPeak);
    var total = r.input + r.cached + r.output;
    var cachePct = total > 0 ? (r.cached / total) * 100 : null;
    var avgCtx = view === "requests" ? total : r.requests > 0 ? total / r.requests : 0;
    var lastUsed = r.lastSeen ? formatRelative(r.lastSeen) : "–";
    return (
      "<tr data-ctx-row" + sessionRow + keyRow + (clickable ? ' class="ctx-row"' : "") + ">" +
      "<td><span class=\"cell-primary\">" + esc(r.name) + "</span>" +
      '<span class="cell-secondary ctx-row__sub">' + esc(r.title) + "</span></td>" +
      '<td class="numeric">' + nf.format(r.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(r.input) + "</td>" +
      '<td class="numeric">' + formatTokens(r.cached) + "</td>" +
      '<td class="numeric">' + formatTokens(r.output) + "</td>" +
      '<td class="numeric">' + (cachePct === null ? "–" : cachePct.toFixed(1) + "%") + "</td>" +
      '<td class="numeric">' + formatTokens(r.peak) + "</td>" +
      '<td class="numeric">' + windowCellHtml + "</td>" +
      '<td class="numeric">' + (view === "requests" ? "–" : formatTokens(Math.round(avgCtx))) + "</td>" +
      '<td class="numeric cell-secondary">' + lastUsed + "</td>" +
      "</tr>"
    );
  }).join("");
  icons();
  refreshTooltips();
  if (view === "session" && selectedSession) {
    var sess = (snap.bySession || []).filter(function (s) { return s.id === selectedSession; })[0];
    if (sess) renderContextGrowth(sess);
  }
}

/* ---------------- Details drawer ---------------- */

function drawerRow(label, value, valueClass) {
  return '<div class="drawer-row"><span class="drawer-row__label">' + esc(label) +
    '</span><span class="drawer-row__value ' + (valueClass || "") + '">' + value + "</span></div>";
}

function drawerSection(title, rows) {
  return '<div class="drawer-sec"><div class="drawer-sec__title">' + esc(title) + "</div>" + rows.join("") + "</div>";
}

function latestRequestFor(key, isModel) {
  var reqs = (state.contextUsage.requests || []).slice();
  for (var i = reqs.length - 1; i >= 0; i--) {
    if (isModel ? reqs[i].model === key : reqs[i].agent === key) return reqs[i];
  }
  return null;
}

function openContextDrawer(item, view) {
  if (!item) return;
  bindDrawerControls();
  var drawer = $("#ctxDrawer");
  var body = $("#ctxDrawerBody");
  $("#ctxDrawerTitle").textContent = view === "session" ? "Session" : view === "agent" ? "Agent" : "Model";

  var peak = item.maxTotal || item.peak || 0;
  var lastSeen = item.lastSeen || 0;
  var isModel = view === "model";
  var current = view === "session" ? null : latestRequestFor(item.id, isModel);
  var total = item.input + item.cached + item.output;
  var cachePct = total > 0 ? (item.cached / total) * 100 : null;
  var avgCtx = item.requests > 0 ? total / item.requests : 0;
  var limit = item.contextLimit || (current && current.contextLimit) || 0;
  var peakPct = limit > 0 ? (peak / limit) * 100 : null;
  var ctxPct = limit > 0 ? Math.min(100, peakPct || 0) : 0;
  var cls = utilClass(ctxPct);

  var contextRows = [];
  if (current) {
    var curUsed = current.input + current.cached + current.output + current.reasoning;
    var curLimit = current.contextLimit || 1;
    var curPct = (curUsed / curLimit) * 100;
    var curCls = utilClass(curPct);
    contextRows.push(
      '<div class="drawer-bar">' +
      '<div class="drawer-bar__fill ' + curCls + '" style="width:' + Math.min(curPct, 100).toFixed(1) + '%"></div>' +
      "</div>" +
      drawerRow("Current context", formatTokens(curUsed) + " / " + formatTokens(curLimit),
        utilTextClass(curCls)) +
      drawerRow("Window usage", curPct.toFixed(1) + "%", utilTextClass(curCls))
    );
  }
  contextRows.push(drawerRow("Average context", formatTokens(Math.round(avgCtx))));
  contextRows.push(drawerRow("Peak context", formatTokens(peak) +
    (peakPct !== null ? " · " + peakPct.toFixed(1) + "%" : ""), utilTextClass(cls)));
  if (cachePct !== null) contextRows.push(drawerRow("Cache ratio", cachePct.toFixed(1) + "%"));
  contextRows.push(drawerRow("Total requests", nf.format(item.requests)));

  body.innerHTML =
    '<div class="ctx-drawer__id">' + esc(item.id) + "</div>" +
    drawerSection("Context", contextRows) +
    drawerSection("Activity", [
      drawerRow("Last activity", formatRelative(lastSeen) + " · " + formatDateTime(lastSeen))
    ]) +
    (view === "session"
      ? '<div class="drawer-actions">' +
        '<button class="btn btn--primary" id="ctxDrawerGrowth" type="button">Inspect growth</button>' +
        "</div>"
      : "");

  icons();
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  $("#ctxDrawerScrim").hidden = false;
  ctxDrawerOpen = true;
  $("#ctxDrawerClose").focus();

  var gBtn = $("#ctxDrawerGrowth");
  if (gBtn) {
    gBtn.addEventListener("click", function () {
      closeContextDrawer();
      selectedSession = item.id;
      var card = $("#ctxGrowthCard");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      if (item.growth) renderContextGrowth(item);
      else {
        var sess = (state.contextUsage.bySession || []).filter(function (s) { return s.id === item.id; })[0];
        if (sess) renderContextGrowth(sess);
      }
    });
  }
}

function bindDrawerControls() {
  if (document.getElementById("ctxDrawer").dataset.bound) return;
  document.getElementById("ctxDrawer").dataset.bound = "1";
  function close() { closeContextDrawer(); }
  $("#ctxDrawerClose").addEventListener("click", close);
  $("#ctxDrawerScrim").addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ctxDrawerOpen) closeContextDrawer();
  });
}

function closeContextDrawer() {
  $("#ctxDrawer").hidden = true;
  $("#ctxDrawer").setAttribute("aria-hidden", "true");
  $("#ctxDrawerScrim").hidden = true;
  ctxDrawerOpen = false;
}

/* ---------------- Conversation growth ---------------- */

function showGrowthEmpty() {
  var empty = $("#ctxGrowthEmpty");
  var wrap = $("#ctxGrowthWrap");
  var meta = $("#ctxGrowthMeta");
  var card = $("#ctxGrowthCard");
  if (ctxGrowthChart) { ctxGrowthChart.destroy(); ctxGrowthChart = null; }
  if (empty) empty.hidden = false;
  if (wrap) wrap.hidden = true;
  if (meta) meta.hidden = true;
  if (card) card.classList.remove("has-session");
}

function bindGrowthControls() {
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
  selectedSession = sid;
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
  if (ctxGrowthChart) { ctxGrowthChart.destroy(); ctxGrowthChart = null; }
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
  var ctx = canvas.getContext("2d");
  var inputColor = cssVar("--chart-input");
  var outputColor = cssVar("--sem-output") || "#3a6ea5";
  var cachedColor = cssVar("--sem-cached") || "#5f6c7e";
  var grad = ctx.createLinearGradient(0, 0, 0, 80);
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

  ctxGrowthChart = new Chart(canvas, {
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
  chartRegistry.contextGrowth = ctxGrowthChart;
}

export function renderContext(snap) {
  if (!snap) return;
  bindGrowthControls();
  renderLatest(snap);
  renderComposition(snap);
  renderBreakdown(snap);
}
