/* Knowledge graph view: native vis-network (Graph / Folders) plus generated
   HTML views (File tree / Call flow) sourced from graphify-out/.
   Native view supports node search, type filter, isolated-hide, zoom,
   a type legend and a node inspector. */

import { state } from "../core/state.js";
import { $, $all, esc } from "../core/utils.js";
import { httpJson, liveUrl } from "../live/api.js";

var VIEWS = ["graph", "folder", "tree", "callflow"];

/* Muted community palette - no purple; warm hues reserved for status. */
var COMMUNITY_COLORS = [
  "#3e63dd", "#00a2c7", "#46a758", "#f5a524",
  "#f76b15", "#30a46c", "#e5484d", "#7a8699",
];

var TYPE_LABELS = {
  file: "File", module: "Module", function: "Function", class: "Class",
  skill: "Skill", mcp: "MCP", config: "Config",
  document: "Document", concept: "Concept", rationale: "Rationale"
};

var TYPE_COLORS = {
  file: "#3e63dd", module: "#00a2c7", function: "#46a758", class: "#f5a524",
  skill: "#f76b15", mcp: "#e5484d", config: "#8b93a5",
  document: "#7a8699", concept: "#30a46c", rationale: "#5f6c7e"
};

var network = null;
var currentView = null;
var loaded = false;
var lastData = null;

var graphState = { search: "", type: "all", isolated: false };

function viewUrl(file) {
  var t = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  return liveUrl("/graphify-out/views/" + file) + "?theme=" + t;
}

function graphUrl(force) {
  var url = liveUrl("/api/graph");
  var q = [];
  if (force) q.push("refresh=1");
  if (state.project && state.project !== "(unknown)") {
    q.push("project=" + encodeURIComponent(state.project));
  }
  if (q.length) url += "?" + q.join("&");
  return url;
}

function showEmpty(title, sub) {
  $("#graphSub").textContent = "graphify-out/graph.json";
  $("#graphEmptyTitle").textContent = title;
  $("#graphEmptySub").textContent = sub || "";
  $("#graphEmpty").hidden = false;
  $("#graphContainer").innerHTML = "";
  $("#graphMain").hidden = false;
  $("#graphFrame").hidden = true;
  $("#graphControls").hidden = true;
  $("#graphInspector").hidden = true;
  if (network) { network.destroy(); network = null; }
}

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function typeLabel(t) {
  return TYPE_LABELS[t] || (t ? String(t).replace(/^\w/, function (c) { return c.toUpperCase(); }) : "Node");
}

function nodeTitle(n) {
  var bits = ["<b>" + esc(n.label || n.id) + "</b>"];
  if (n.file_type) bits.push(typeLabel(n.file_type));
  if (n.source_file) bits.push(esc(n.source_file));
  if (n.community_name) bits.push("community: " + esc(n.community_name));
  return bits.join("<br>");
}

function isFileNode(n) {
  if (!n.source_file) return false;
  var base = String(n.source_file).split(/[/\\]/).pop();
  return !!base && n.label === base;
}

/* ---------- filtering ---------- */

function nodePasses(n) {
  if (graphState.type !== "all" && n.file_type !== graphState.type) return false;
  if (graphState.search) {
    var q = graphState.search.toLowerCase();
    var hay = (String(n.label || "") + " " + String(n.source_file || "")).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

function filteredData(d) {
  var nodes = d.nodes.filter(nodePasses);
  if (graphState.isolated) {
    var linked = {};
    d.links.forEach(function (l) {
      linked[l.source] = 1;
      linked[l.target] = 1;
    });
    nodes = nodes.filter(function (n) { return linked[n.id]; });
  }
  var ids = {};
  nodes.forEach(function (n) { ids[n.id] = 1; });
  var links = d.links.filter(function (l) { return ids[l.source] && ids[l.target]; });
  return { nodes: nodes, links: links, directed: d.directed };
}

function nodeDegree(id, links) {
  var deg = 0;
  links.forEach(function (l) {
    if (l.source === id || l.target === id) deg++;
  });
  return deg;
}

/* ---------- data builders ---------- */

function symbolData(f) {
  var maxW = f.links.reduce(function (a, l) { return Math.max(a, l.weight || 1); }, 1);
  var nodes = f.nodes.map(function (n) {
    var community = typeof n.community === "number" ? n.community % COMMUNITY_COLORS.length : 0;
    var file = isFileNode(n);
    var deg = nodeDegree(n.id, f.links);
    return {
      id: n.id,
      label: n.label,
      title: nodeTitle(n),
      shape: file ? "box" : "dot",
      size: file ? 18 : Math.min(8 + deg * 0.9, 16),
      color: { background: COMMUNITY_COLORS[community], border: COMMUNITY_COLORS[community], highlight: { background: COMMUNITY_COLORS[community], border: "#ffffff" } },
      font: { face: "monospace", size: file ? 12 : 10 },
    };
  });
  var edges = f.links.map(function (l) {
    var opacity = 0.18 + 0.55 * Math.min((l.weight || 1) / maxW, 1);
    return {
      from: l.source,
      to: l.target,
      title: (l.relation ? esc(l.relation) : "relation") + " · weight " + (l.weight || 1),
      width: Math.min(1 + (l.weight || 1) * 0.5, 5),
      color: { opacity: opacity, highlight: "#3e63dd", hover: "#3e63dd" },
    };
  });
  return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
}

function folderData(f) {
  var folders = {};
  var folderOf = {};

  function register(parent, name) {
    var id = "dir:" + parent;
    if (!folders[id]) {
      folders[id] = { id: id, label: name, path: parent, parent: parent.indexOf("/") >= 0 ? "dir:" + parent.slice(0, parent.lastIndexOf("/")) : null };
    }
    return id;
  }

  f.nodes.forEach(function (n) {
    var sf = String(n.source_file || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!sf) return;
    var parts = sf.split("/");
    parts.pop();
    var fp = "";
    var parent = "";
    for (var i = 0; i < parts.length; i++) {
      parent = fp;
      fp = fp ? fp + "/" + parts[i] : parts[i];
      register(fp, parts[i]);
    }
    folderOf[n.id] = fp ? "dir:" + fp : null;
  });

  var nodes = [];
  var edges = [];
  var dark = isDark();

  Object.keys(folders).forEach(function (id) {
    var fo = folders[id];
    nodes.push({
      id: fo.id,
      label: fo.label,
      title: "folder: " + fo.path,
      shape: "box",
      size: 14,
      color: { background: dark ? "#1f2430" : "#eef1f7", border: "#3e63dd", highlight: { background: "#3e63dd", border: "#ffffff" } },
      font: { face: "monospace", size: 12, color: dark ? "#c8cde0" : "#2b2f36" },
    });
    if (fo.parent) edges.push({ from: fo.parent, to: fo.id, dashes: true, title: "contains", color: { opacity: 0.35 } });
  });

  f.nodes.forEach(function (n) {
    var sf = String(n.source_file || "").replace(/\\/g, "/");
    if (!sf) return;
    var base = sf.split("/").pop();
    var community = typeof n.community === "number" ? n.community % COMMUNITY_COLORS.length : 0;
    nodes.push({
      id: n.id,
      label: base,
      title: nodeTitle(n),
      shape: "dot",
      size: 10,
      color: { background: COMMUNITY_COLORS[community], border: COMMUNITY_COLORS[community], highlight: { background: COMMUNITY_COLORS[community], border: "#ffffff" } },
      font: { face: "monospace", size: 10 },
    });
    if (folderOf[n.id]) edges.push({ from: folderOf[n.id], to: n.id, dashes: true, title: "contains", color: { opacity: 0.3 } });
  });

  var rel = {};
  f.links.forEach(function (l) {
    var a = folderOf[l.source];
    var b = folderOf[l.target];
    if (a && b && a !== b) {
      var k = a + "|" + b;
      rel[k] = rel[k] || { from: a, to: b, count: 0, rels: {} };
      rel[k].count++;
      rel[k].rels[l.relation] = (rel[k].rels[l.relation] || 0) + 1;
    }
  });
  Object.keys(rel).forEach(function (k) {
    var r = rel[k];
    var rels = Object.keys(r.rels).sort(function (x, y) { return r.rels[y] - r.rels[x]; });
    var summary = rels.slice(0, 3).map(function (x) { return x + " \u00d7 " + r.rels[x]; }).join(", ");
    edges.push({
      from: r.from,
      to: r.to,
      width: Math.min(1 + r.count / 3, 6),
      title: summary,
      label: String(r.count),
      font: { size: 9, color: "#8b93a5" },
      smooth: { type: "continuous" },
    });
  });

  return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
}

/* ---------- legend + inspector ---------- */

function renderLegend(d) {
  var el = $("#graphLegend");
  if (!el) return;
  var counts = {};
  d.nodes.forEach(function (n) {
    var t = n.file_type || "node";
    counts[t] = (counts[t] || 0) + 1;
  });
  var types = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  el.innerHTML = types.map(function (t) {
    var color = TYPE_COLORS[t] || "#8b93a5";
    return '<span class="graph-legend__item" title="' + counts[t] + " nodes\"><i style=\"background:" + color + "\"></i>" + typeLabel(t) + " <em>" + counts[t] + "</em></span>";
  }).join("");
}

function renderInspector(id) {
  var d = lastData;
  var n = d.nodes.filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  var inc = d.links.filter(function (l) { return l.target === id; });
  var out = d.links.filter(function (l) { return l.source === id; });
  var nodeById = {};
  d.nodes.forEach(function (x) { nodeById[x.id] = x; });

  function linkRows(list, dir) {
    return list.slice(0, 12).map(function (l) {
      var otherId = dir === "out" ? l.target : l.source;
      var other = nodeById[otherId];
      var label = other ? (other.label || otherId) : otherId;
      var arrow = dir === "out" ? "&rarr;" : "&larr;";
      return (
        '<div class="graph-inspector__link">' +
        "<span class=\"mono\">" + esc(l.relation || "relation") + " " + arrow + " " + esc(String(label).slice(0, 42)) + "</span>" +
        '<span class="cell-secondary">' + (l.weight || 1) + "</span>" +
        "</div>"
      );
    }).join("") || '<span class="cell-secondary">None</span>';
  }

  var body = $("#graphInspectorBody");
  var path = (n.source_file || "?") + (n.source_location ? ":" + n.source_location : "");
  body.innerHTML =
    '<div class="graph-inspector__node">' +
    '<span class="graph-inspector__name">' + esc(n.label || n.id) + "</span>" +
    '<span class="status-badge">' + esc(typeLabel(n.file_type)) + "</span>" +
    '<span class="graph-inspector__path mono">' + esc(path) + "</span>" +
    (n.community_name ? '<span class="cell-secondary">community: ' + esc(n.community_name) + "</span>" : "") +
    "</div>" +
    '<div class="graph-inspector__sec"><h4>Incoming (' + inc.length + ")</h4>" + linkRows(inc, "in") + "</div>" +
    '<div class="graph-inspector__sec"><h4>Outgoing (' + out.length + ")</h4>" + linkRows(out, "out") + "</div>" +
    '<div class="graph-inspector__actions">' +
    '<button class="btn btn--sm" id="graphFocusNode" type="button"><i data-lucide="maximize"></i>Focus graph</button>' +
    "</div>";
  var fBtn = $("#graphFocusNode");
  if (fBtn && network) {
    fBtn.addEventListener("click", function () { network.focus(id, { scale: 1.3, animation: true }); });
  }
  $("#graphInspector").hidden = false;
}

/* ---------- draw ---------- */

function drawNative(view, d) {
  if (network) { network.destroy(); network = null; }
  $("#graphEmpty").hidden = true;
  if (!window.vis) {
    showEmpty("Graph library unavailable", "vis-network CDN could not be loaded. Use the File tree or Call flow views instead.");
    return;
  }
  var container = $("#graphContainer");
  var f = filteredData(d);
  var data = view === "folder" ? folderData(f) : symbolData(f);
  var dark = isDark();
  var opts = {
    nodes: {
      shape: "dot",
      size: 10,
      borderWidth: 1,
      shadow: false,
      font: { color: dark ? "#d7dbe0" : "#30343b", strokeWidth: 0, size: 11 },
    },
    edges: {
      smooth: { type: "continuous", roundness: 0.4 },
      color: { color: dark ? "rgba(200,210,230,0.4)" : "rgba(40,50,70,0.28)", highlight: "#3e63dd", hover: "#3e63dd" },
      font: { size: 9, strokeWidth: 0, color: "#8b93a5" },
      selectionWidth: 1.5,
    },
    physics: { stabilization: { iterations: 100 }, barnesHut: { gravitationalConstant: -3500, springLength: 110, springConstant: 0.05 } },
    interaction: { hover: true, tooltipDelay: 100, navigationButtons: false, keyboard: true },
  };
  if (d.directed) opts.edges.arrows = { to: { scaleFactor: 0.5 } };
  network = new vis.Network(container, data, opts);
  network.once("stabilizationIterationsDone", function () { network.setOptions({ physics: false }); });
  network.on("click", function (params) {
    if (params.nodes && params.nodes.length) renderInspector(params.nodes[0]);
    else $("#graphInspector").hidden = true;
  });
  renderLegend(d);
  $("#graphSub").textContent = d.nodes.length + " nodes \u00b7 " + d.links.length + " links \u00b7 graphify-out/graph.json" +
    (f.nodes.length !== d.nodes.length ? " \u00b7 showing " + f.nodes.length + " after filters" : "");
}

function applyView(view, d) {
  currentView = view;
  if (view === "tree" || view === "callflow") {
    $("#graphMain").hidden = true;
    $("#graphFrame").hidden = false;
    $("#graphEmpty").hidden = true;
    $("#graphControls").hidden = true;
    $("#graphInspector").hidden = true;
    var file = view === "tree" ? "tree.html" : "callflow.html";
    var src = viewUrl(file);
    var ifr = $("#graphIframe");
    if (ifr.getAttribute("src") !== src) ifr.setAttribute("src", src);
    $("#graphFullscreen").setAttribute("href", src);
    return;
  }
  $("#graphFrame").hidden = true;
  $("#graphMain").hidden = false;
  $("#graphControls").hidden = false;
  $("#graphFullscreen").setAttribute("href", liveUrl("/graphify-out/views/graph.html"));
  drawNative(view, d);
}

export function setGraphView(view) {
  if (VIEWS.indexOf(view) < 0) view = "graph";
  currentView = view;
  $all("[data-graph-view]").forEach(function (b) {
    var on = b.getAttribute("data-graph-view") === view;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  try { localStorage.setItem("graphView", view); } catch (e) {}
  if (loaded) renderGraph(false);
}

function rerenderNative() {
  if (loaded && (currentView === "graph" || currentView === "folder")) {
    drawNative(currentView, lastData);
  }
}

export function initGraphControls() {
  $all("[data-graph-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      setGraphView(b.getAttribute("data-graph-view"));
    });
  });
  var saved = "graph";
  try { saved = localStorage.getItem("graphView") || "graph"; } catch (e) {}
  setGraphView(VIEWS.indexOf(saved) >= 0 ? saved : "graph");

  var searchEl = $("#graphSearch");
  if (searchEl) {
    var debounce = null;
    searchEl.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        graphState.search = searchEl.value.trim();
        rerenderNative();
      }, 250);
    });
  }
  var typeEl = $("#graphTypeFilter");
  if (typeEl) {
    typeEl.addEventListener("change", function () {
      graphState.type = typeEl.value;
      rerenderNative();
    });
  }
  var hideEl = $("#graphHideIsolated");
  if (hideEl) {
    hideEl.addEventListener("change", function () {
      graphState.isolated = hideEl.checked;
      rerenderNative();
    });
  }
  function zoom(mult) {
    if (!network) return;
    var scale = network.getScale();
    network.moveTo({ scale: scale * mult, animation: { duration: 200, easingFunction: "easeInOutQuad" } });
  }
  var zi = $("#graphZoomIn");
  if (zi) zi.addEventListener("click", function () { zoom(1.25); });
  var zo = $("#graphZoomOut");
  if (zo) zo.addEventListener("click", function () { zoom(0.8); });
  var zf = $("#graphFit");
  if (zf) zf.addEventListener("click", function () { if (network) network.fit({ animation: { duration: 200 } }); });
  var zr = $("#graphReset");
  if (zr) zr.addEventListener("click", function () {
    if (network) network.moveTo({ scale: 1, position: { x: 0, y: 0 }, animation: { duration: 200 } });
  });
  var ic = $("#graphInspectorClose");
  if (ic) ic.addEventListener("click", function () { $("#graphInspector").hidden = true; });
}

export function renderGraph(force) {
  httpJson(graphUrl(force), 15000)
    .then(function (d) {
      if (!d || !d.ok) {
        showEmpty("Graph not available", (d && d.hint) || (d && d.error) || "Run `graphify extract . --code-only`, then Refresh.");
        return;
      }
      loaded = true;
      lastData = d;
      $("#graphSub").textContent = d.nodes.length + " nodes \u00b7 " + d.links.length + " links \u00b7 graphify-out/graph.json";
      var typeEl = $("#graphTypeFilter");
      if (typeEl) {
        var counts = {};
        d.nodes.forEach(function (n) {
          var t = n.file_type || "node";
          counts[t] = (counts[t] || 0) + 1;
        });
        var current = typeEl.value;
        typeEl.innerHTML = '<option value="all">All types</option>' +
          Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (t) {
            return '<option value="' + esc(t) + '">' + esc(typeLabel(t)) + " (" + counts[t] + ")</option>";
          }).join("");
        typeEl.value = graphState.type !== "all" && counts[graphState.type] ? graphState.type : "all";
        if (typeEl.value === "all") graphState.type = "all";
      }
      if (!d.nodes.length) {
        showEmpty("No matching nodes", "The selected project is not part of this knowledge graph.");
        return;
      }
      applyView(currentView || "graph", d);
    })
    .catch(function (e) {
      showEmpty("Graph unreachable", (e && e.message) || "Could not reach the server.");
    });
}

export function refreshGraphTheme() {
  if (lastData) applyView(currentView || "graph", lastData);
}
