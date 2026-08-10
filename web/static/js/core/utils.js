/* Shared formatting + DOM helpers. No project dependencies. */

export var nf = new Intl.NumberFormat("en-US");

export function round(x) { return Math.round(x); }

export function trim(x) {
  var r = Math.round(x * 100) / 100;
  return r >= 100 ? String(Math.round(r)) : String(r);
}

export function formatTokens(v) {
  var abs = Math.abs(v);
  if (abs >= 1e9) return trim(v / 1e9) + "B";
  if (abs >= 1e6) return trim(v / 1e6) + "M";
  if (abs >= 1e3) return trim(v / 1e3) + "K";
  return nf.format(v);
}

export function formatLatency(ms) {
  if (ms >= 1000) return trim(ms / 1000) + " s";
  return nf.format(ms) + " ms";
}

export function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function pad2(n) { return (n < 10 ? "0" : "") + n; }

export function formatRelative(ts) {
  var diff = Date.now() - ts;
  var s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  var m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  var h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  var d = Math.floor(h / 24);
  return d + "d ago";
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function hexToRgba(hex, alpha) {
  var n = parseInt(String(hex).replace("#", ""), 16);
  if (isNaN(n)) return "rgba(0,0,0,0)";
  var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

export function icons() {
  if (window.lucide) lucide.createIcons();
}

export function $(sel, root) { return (root || document).querySelector(sel); }
export function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

export function downloadBlob(content, filename, mime) {
  var blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 300);
}

export function formatDateTime(ms) {
  var d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour12: false });
}

export function exact(n) {
  return nf.format(Math.round(n));
}
