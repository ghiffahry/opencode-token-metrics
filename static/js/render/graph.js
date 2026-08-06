/* Knowledge graph view: native vis-network (Graph / Folders) plus generated
   HTML views (File tree / Call flow) sourced from graphify-out/. */

import { state } from "../core/state.js";
import { $, $all, esc } from "../core/utils.js";
import { httpJson, liveUrl } from "../live/api.js";

var VIEWS = ["graph", "folder", "tree", "callflow"];
var COMMUNITY_COLORS = [
  "#e5484d", "#f76b15", "#f5a524", "#ffd400", "#46a758",
  "#30a46c", "#00a2c7", "#3e63dd", "#8e4ec6", "#d6409f",
];

var network = null;
var currentView = null;
var loaded = false;
var lastData = null;

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
  $("#graphNative").hidden = false;
  $("#graphFrame").hidden = true;
  if (network) { network.destroy(); network = null; }
}

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function nodeTitle(n) {
  var bits = ["<b>" + esc(n.label || n.id) + "</b>"];
  if (n.source_file) bits.push(esc(n.source_file));
  if (n.community_name) bits.push("community: " + esc(n.community_name));
  return bits.join("<br>");
}

function isFileNode(n) {
  if (!n.source_file) return false;
  var base = String(n.source_file).split(/[/\\]/).pop();
  return !!base && n.label === base;
}

function symbolData(d) {
  var nodes = d.nodes.map(function (n) {
    var community = typeof n.community === "number" ? n.community % COMMUNITY_COLORS.length : 0;
    var file = isFileNode(n);
    return {
      id: n.id,
      label: n.label,
      title: nodeTitle(n),
      shape: file ? "box" : "dot",
      size: file ? 18 : 10,
      color: { background: COMMUNITY_COLORS[community], border: COMMUNITY_COLORS[community], highlight: { background: COMMUNITY_COLORS[community], border: "#ffffff" } },
      font: { face: "monospace", size: file ? 12 : 10 },
    };
  });
  var edges = d.links.map(function (l) {
    return {
      from: l.source,
      to: l.target,
      title: l.relation ? esc(l.relation) : "",
      width: Math.min(1 + (l.weight || 1) * 0.5, 5),
    };
  });
  return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
}

function folderData(d) {
  var folders = {};
  var folderOf = {};

  function register(parent, name) {
    var id = "dir:" + parent;
    if (!folders[id]) {
      folders[id] = { id: id, label: name, path: parent, parent: parent.indexOf("/") >= 0 ? "dir:" + parent.slice(0, parent.lastIndexOf("/")) : null };
    }
    return id;
  }

  d.nodes.forEach(function (n) {
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
    var f = folders[id];
    nodes.push({
      id: f.id,
      label: f.label,
      title: "folder: " + f.path,
      shape: "box",
      size: 14,
      color: { background: dark ? "#1f2430" : "#eef1f7", border: "#3e63dd", highlight: { background: "#3e63dd", border: "#ffffff" } },
      font: { face: "monospace", size: 12, color: dark ? "#c8cde0" : "#2b2f36" },
    });
    if (f.parent) edges.push({ from: f.parent, to: f.id, dashes: true, title: "contains", color: { opacity: 0.35 } });
  });

  d.nodes.forEach(function (n) {
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
  d.links.forEach(function (l) {
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

function drawNative(view, d) {
  if (network) { network.destroy(); network = null; }
  $("#graphEmpty").hidden = true;
  if (!window.vis) {
    showEmpty("Graph library unavailable", "vis-network CDN could not be loaded. Use the File tree or Call flow views instead.");
    return;
  }
  var container = $("#graphContainer");
  var data = view === "folder" ? folderData(d) : symbolData(d);
  var dark = isDark();
  var opts = {
    nodes: {
      shape: "dot",
      size: 10,
      borderWidth: 1,
      shadow: false,
      font: { color: dark ? "#d7dbe0" : "#30343b", strokeWidth: dark ? 0 : 0, size: 11 },
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
}

function applyView(view, d) {
  currentView = view;
  if (view === "tree" || view === "callflow") {
    $("#graphNative").hidden = true;
    $("#graphFrame").hidden = false;
    $("#graphEmpty").hidden = true;
    var file = view === "tree" ? "tree.html" : "callflow.html";
    var src = viewUrl(file);
    var ifr = $("#graphIframe");
    if (ifr.getAttribute("src") !== src) ifr.setAttribute("src", src);
    $("#graphFullscreen").setAttribute("href", src);
    return;
  }
  $("#graphFrame").hidden = true;
  $("#graphNative").hidden = false;
  $("#graphFullscreen").setAttribute("href", liveUrl("/graphify-out/views/graph.html"));
  drawNative(view, d);
}

export function setGraphView(view) {
  if (VIEWS.indexOf(view) < 0) view = "graph";
  currentView = view;
  $all(".segment-btn").forEach(function (b) {
    var on = b.getAttribute("data-graph-view") === view;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  try { localStorage.setItem("graphView", view); } catch (e) {}
  if (loaded) renderGraph(false);
}

export function initGraphControls() {
  $all(".segment-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      setGraphView(b.getAttribute("data-graph-view"));
    });
  });
  var saved = "graph";
  try { saved = localStorage.getItem("graphView") || "graph"; } catch (e) {}
  setGraphView(VIEWS.indexOf(saved) >= 0 ? saved : "graph");
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
