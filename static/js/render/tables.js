/* Table renders: models, sessions, per-day, requests, rate limits. */

import { state } from "../core/state.js";
import { $, nf, esc, clamp, exact, formatTokens, formatLatency, formatRelative } from "../core/utils.js";

export function statusBadge(status) {
  var map = {
    success: ["success", "Success"],
    error: ["danger", "Error"],
    active: ["info", "Active"],
    idle: ["neutral", "Idle"],
    limited: ["warning", "Limited"]
  };
  var m = map[status] || ["neutral", status];
  return '<span class="status-badge status-badge--' + m[0] + '">' + m[1] + "</span>";
}

export function contextCell(m) {
  var limit = m.contextLimit || 0;
  if (!limit) return '<span class="cell-secondary">-</span>';
  var used = clamp(m.contextUsed || 0, 0, limit);
  var pct = (used / limit) * 100;
  var cls = pct >= 90 ? "is-danger" : pct >= 75 ? "is-warning" : "";
  return (
    '<span class="ctx">' +
    '<span class="ctx__bar"><span class="ctx__fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="ctx__num">' + formatTokens(used) + " <em>/ " + formatTokens(limit) + "</em></span>" +
    "</span>"
  );
}

export function renderModelTable(view) {
  var list = view.models.slice();
  if (state.modelFilter !== "all") list = list.filter(function (m) { return m.id === state.modelFilter; });
  if (state.modelSearch) {
    var q = state.modelSearch.toLowerCase();
    list = list.filter(function (m) { return m.name.toLowerCase().indexOf(q) !== -1; });
  }
  var s = state.sort;
  list.sort(function (a, b) {
    var av = s.key === "model" ? a.name : a[s.key];
    var bv = s.key === "model" ? b.name : b[s.key];
    if (typeof av === "string") return s.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return s.dir === "asc" ? av - bv : bv - av;
  });

  $("#modelEmpty").hidden = list.length > 0;
  $("#modelTable").style.display = list.length ? "" : "none";

  $("#modelBody").innerHTML = list.map(function (m) {
    var success = Math.max(0, m.requests - m.errors);
    var rate = (success / m.requests) * 100;
    var isFiltered = state.modelFilter === m.id;
    return (
      "<tr data-model-id=\"" + esc(m.id) + "\" data-filtered=\"" + isFiltered + "\" class=\"" + (isFiltered ? "is-filtered" : "") + "\">" +
      '<td class="cell-primary">' + esc(m.name) + "</td>" +
      '<td class="numeric" title="' + nf.format(m.requests) + ' requests">' + nf.format(m.requests) + "</td>" +
      '<td class="numeric" title="' + nf.format(m.input) + ' tokens">' + formatTokens(m.input) + "</td>" +
      '<td class="numeric" title="' + nf.format(m.output) + ' tokens">' + formatTokens(m.output) + "</td>" +
      '<td class="numeric" title="' + nf.format(m.input + m.output) + ' tokens"><strong>' + formatTokens(m.input + m.output) + "</strong></td>" +
      '<td class="numeric" title="' + nf.format(m.errors) + ' errors">' + (m.errors ? nf.format(m.errors) : "0") + "</td>" +
      '<td class="numeric" title="' + rate.toFixed(2) + '% success rate">' + rate.toFixed(2) + "%</td>" +
      '<td class="numeric" title="' + nf.format(m.latency) + ' ms average">' + formatLatency(m.latency) + "</td>" +
      '<td class="numeric">' + contextCell(m) + "</td>" +
      "<td>" + statusBadge(m.status.toLowerCase()) + "</td>" +
      "</tr>"
    );
  }).join("");
}

export function renderSessionTable() {
  var list = (state.liveRealtime && state.liveRealtime.sessions) || [];
  var rows = list.map(function (s) {
    var model = { short: s.model.split("/").pop() };
    return (
      "<tr data-session-id=\"" + esc(s.id) + "\" class=\"session-row\">" +
      '<td><span class="cell-primary mono">' + esc(s.id) + "</span><br><span class=\"cell-secondary\">" + esc(s.title || s.user) + "</span></td>" +
      "<td>" + esc(model.short) + "</td>" +
      '<td class="numeric">' + formatTokens(s.input) + "</td>" +
      '<td class="numeric">' + formatTokens(s.output) + "</td>" +
      '<td class="numeric"><strong>' + formatTokens(s.input + s.output) + "</strong></td>" +
      '<td class="numeric">' + formatLatency(s.latency) + "</td>" +
      "<td>" + statusBadge(s.status) + "</td>" +
      "</tr>"
    );
  }).join("");
  $("#sessionBody").innerHTML = rows;
  $("#sessionEmpty").hidden = list.length > 0;
  $("#sessionMeta").textContent = list.filter(function (s) { return s.status === "active"; }).length + " active";
}

export function renderPerDay(view) {
  var rows = view.tableRows;
  var sum = rows.reduce(function (a, r) { return a + (r.input + r.output); }, 0);
  $("#perDayBody").innerHTML = rows.map(function (r) {
    var total = r.input + r.output;
    var share = sum ? (total / sum) * 100 : 0;
    return (
      "<tr>" +
      '<td class="cell-primary">' + esc(r.label) + "</td>" +
      '<td class="numeric">' + nf.format(r.requests) + "</td>" +
      '<td class="numeric">' + formatTokens(r.input) + "</td>" +
      '<td class="numeric">' + formatTokens(r.output) + "</td>" +
      '<td class="numeric"><strong>' + formatTokens(total) + "</strong></td>" +
      '<td class="numeric cell-secondary">' + share.toFixed(1) + "%</td>" +
      "</tr>"
    );
  }).join("");
  $("#perDayMeta").textContent = (view.range === "today" || view.range === "24h") ? "Today" : rows.length + " days";
}

export function getFilteredRequests() {
  var list = (state.view.requestsList || []).slice();
  if (state.modelFilter !== "all") list = list.filter(function (r) { return r.modelId === state.modelFilter; });
  if (state.agentFilter !== "all") list = list.filter(function (r) { return r.agent === state.agentFilter; });
  if (state.requestSearch) {
    var q = state.requestSearch.toLowerCase();
    list = list.filter(function (r) {
      return (r.id || "").toLowerCase().indexOf(q) !== -1 ||
        (r.sessionId || "").toLowerCase().indexOf(q) !== -1 ||
        (r.model || "").toLowerCase().indexOf(q) !== -1 ||
        (r.agent || "").toLowerCase().indexOf(q) !== -1;
    });
  }
  return list;
}

export function renderRequests() {
  var list = getFilteredRequests();
  var totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
  state.page = clamp(state.page, 1, totalPages);
  var start = (state.page - 1) * state.pageSize;
  var slice = list.slice(start, start + state.pageSize);

  $("#requestEmpty").hidden = slice.length > 0;
  $("#requestTable").style.display = slice.length ? "" : "none";

  $("#requestBody").innerHTML = slice.map(function (r) {
    return (
      "<tr>" +
      '<td class="mono">' + esc(r.id) + "</td>" +
      "<td>" + esc(r.model) + "</td>" +
      "<td>" + esc(r.agent) + "</td>" +
      '<td class="numeric">' + formatTokens(r.input) + "</td>" +
      '<td class="numeric">' + formatTokens(r.output) + "</td>" +
      '<td class="numeric">' + formatTokens(r.total) + "</td>" +
      '<td class="numeric">' + formatLatency(r.latency) + "</td>" +
      "<td>" + statusBadge(r.status) + "</td>" +
      '<td class="cell-secondary">' + formatRelative(r.time) + "</td>" +
      "</tr>"
    );
  }).join("");

  $("#pageInfo").textContent = "Page " + state.page + " of " + totalPages;
  $("#prevPage").disabled = state.page <= 1;
  $("#nextPage").disabled = state.page >= totalPages;
  $("#requestsSub").textContent = "Latest " + Math.min(slice.length, state.pageSize) + " of " + nf.format(state.view.requests);
}

export function renderRateLimits(view) {
  renderRateLimit("rpm", view.rateLimits.rpm, nf.format);
  renderRateLimit("tpm", view.rateLimits.tpm, formatTokens);
  renderRateLimit("rpd", view.rateLimits.rpd, nf.format);
  renderRateLimit("dtp", view.rateLimits.dtp, formatTokens);
}

export function renderRateLimit(key, data, fmt) {
  var known = Number.isFinite(data.limit) && data.limit > 0;
  var pctRaw = known ? (data.used / data.limit) * 100 : 0;
  var barPct = clamp(pctRaw, 0, 100);
  var over = known && data.used > data.limit;
  var cls = over ? "is-danger" : pctRaw >= 80 ? "is-warning" : "";
  var el = $("#" + key + "Used");
  if (el) {
    el.textContent = fmt(data.used);
    el.title = exact(data.used);
  }
  var lim = $("#" + key + "Limit");
  if (lim) lim.textContent = known ? nf.format(data.limit) : "?";
  var bar = $("#" + key + "Bar");
  if (bar) {
    bar.style.width = barPct.toFixed(1) + "%";
    bar.className = "progress__bar " + cls;
    var barWrap = bar.parentElement;
    if (barWrap) barWrap.setAttribute("aria-valuenow", String(Math.round(pctRaw)));
  }
  var pctEl = $("#" + key + "Pct");
  if (pctEl) {
    pctEl.textContent = known ? pctRaw.toFixed(1) + "%" : "unknown limit";
    pctEl.classList.toggle("is-danger-text", over);
  }
  var badge = $("#" + key + "Badge");
  if (badge) {
    if (!known) { badge.className = "status-badge"; badge.textContent = "Unknown"; }
    else if (over) { badge.className = "status-badge status-badge--danger"; badge.textContent = "Limit exceeded"; }
    else if (pctRaw >= 80) { badge.className = "status-badge status-badge--warning"; badge.textContent = "Warning"; }
    else { badge.className = "status-badge status-badge--success"; badge.textContent = "OK"; }
  }
  var rem = $("#" + key + "Remaining");
  var overEl = $("#" + key + "Over");
  if (overEl) {
    if (over) {
      overEl.hidden = false;
      overEl.textContent = nf.format(data.used - data.limit) + " over " + (data.source === "configured" ? "configured limit" : "limit");
    } else {
      overEl.hidden = true;
    }
  }
  var label = $("#" + key + "Label");
  if (label && (key === "rpd" || key === "dtp")) {
    var kind = data.source === "configured" ? "configured target" : "estimated target";
    label.innerHTML = key === "rpd"
      ? "requests / day · " + kind
      : 'tokens / day · <span id="dtpRemaining">' + (known ? nf.format(Math.max(0, data.limit - data.used)) : "unknown") + "</span> remaining · " + kind;
  } else if (rem) {
    rem.textContent = known ? nf.format(Math.max(0, data.limit - data.used)) : "unknown";
  }
}
