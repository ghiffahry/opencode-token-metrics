import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAPH_JSON = ROOT / "graphify-out" / "graph.json"
VIEWS_DIR = ROOT / "graphify-out" / "views"

EM_DASH = "\u2014"

THEME_SCRIPT = """<script>
(function () {
  function getTheme() {
    try {
      var t = new URLSearchParams(location.search).get('theme');
      if (t === 'light' || t === 'dark') return t;
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var theme = getTheme();
  document.documentElement.setAttribute('data-theme', theme);

  var NODE_COLORS = {
    light: {
      default: { fill: '#ffffff', stroke: '#93c5fd' },
      entry:   { fill: '#fef3c7', stroke: '#d97706', color: '#78350f' },
      api:     { fill: '#fee2e2', stroke: '#ef4444', color: '#7f1d1d' },
      async:   { fill: '#ede9fe', stroke: '#8b5cf6', color: '#4c1d95' },
      klass:   { fill: '#d1fae5', stroke: '#10b981', color: '#064e3b' },
      ui:      { fill: '#fce7f3', stroke: '#ec4899', color: '#831843' },
      module:  { fill: '#eef4ff', stroke: '#2563eb', color: '#1e3a8a' },
      test:    { fill: '#f4f4f5', stroke: '#a1a1aa', color: '#27272a' },
      concept: { fill: '#fafaf9', stroke: '#a8a29e', color: '#44403c' },
      function: { fill: '#ffffff', stroke: '#38bdf8', color: '#0c4a6e' }
    },
    dark: {
      default: { fill: '#1e293b', stroke: '#38bdf8' },
      entry:   { fill: '#422006', stroke: '#fbbf24', color: '#fde68a' },
      api:     { fill: '#450a0a', stroke: '#f87171', color: '#fee2e2' },
      async:   { fill: '#2e1065', stroke: '#a78bfa', color: '#ede9fe' },
      klass:   { fill: '#064e3b', stroke: '#34d399', color: '#d1fae5' },
      ui:      { fill: '#831843', stroke: '#f472b6', color: '#fce7f3' },
      module:  { fill: '#172554', stroke: '#60a5fa', color: '#dbeafe' },
      test:    { fill: '#3f3f46', stroke: '#a1a1aa', color: '#f4f4f5' },
      concept: { fill: '#292524', stroke: '#a8a29e', color: '#fafaf9' },
      function: { fill: '#0f172a', stroke: '#38bdf8', color: '#e0f2fe' }
    }
  };

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255) + ')';
  }

  function paint(el, prop, value) {
    if (!el) return;
    var target = typeof value === 'function' ? value(el) : value;
    if (el.style.getPropertyValue(prop) !== target) {
      el.style.setProperty(prop, target, 'important');
    }
  }

  function applyMermaidTheme() {
    var palette = NODE_COLORS[theme] || NODE_COLORS.dark;
    var light = theme === 'light';
    var edgeStroke = light ? '#60a5fa' : '#64748b';
    var textColor = light ? '#1c2a4a' : '#e2e8f0';
    document.querySelectorAll('.mermaid svg').forEach(function (svg) {
      svg.querySelectorAll('g.node rect').forEach(function (rect) {
        if (!rect.getAttribute('width') || !rect.getAttribute('height')) return;
        var g = rect.parentNode;
        var cls = g ? (g.getAttribute('class') || '') : '';
        var col = null;
        Object.keys(palette).forEach(function (k) {
          if (cls.indexOf(k) !== -1) col = palette[k];
        });
        if (!col) col = palette['default'];
        paint(rect, 'fill', rgb(col.fill));
        paint(rect, 'stroke', rgb(col.stroke));
        paint(rect, 'stroke-width', '1px');
      });
      svg.querySelectorAll('.nodeLabel p, .nodeLabel span, .edgeLabel p, .edgeLabel span, .label p, .label span, tspan').forEach(function (el) {
        paint(el, 'color', rgb(textColor));
        paint(el, 'fill', rgb(textColor));
      });
      svg.querySelectorAll('.labelBkg').forEach(function (el) {
        paint(el, 'background', light ? '#ffffff' : '#1e293b');
        paint(el, 'color', rgb(textColor));
      });
      svg.querySelectorAll('path.flowchart-link, .edgePaths .path, g.edgePath path').forEach(function (p) {
        paint(p, 'stroke', rgb(edgeStroke));
        paint(p, 'fill', 'none');
      });
      svg.querySelectorAll('marker path, path.arrowMarkerPath').forEach(function (p) {
        paint(p, 'fill', rgb(edgeStroke));
        paint(p, 'stroke', rgb(edgeStroke));
      });
      svg.querySelectorAll('g.label rect').forEach(function (r) {
        paint(r, 'fill', light ? '#ffffff' : '#1e293b');
        paint(r, 'stroke', light ? '#c7d7f0' : '#475569');
      });
      svg.querySelectorAll('.cluster rect').forEach(function (r) {
        paint(r, 'fill', light ? '#eef4ff' : '#0f172a');
        paint(r, 'stroke', light ? '#c7d7f0' : '#334155');
      });
    });
  }

  function init() {
    applyMermaidTheme();
    if (window.MutationObserver) {
      new MutationObserver(applyMermaidTheme).observe(document.body, { childList: true, subtree: true });
    }
    [800, 2000].forEach(function (ms) { setTimeout(applyMermaidTheme, ms); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>"""

CALLFLOW_THEME_CSS = """<style id="dashboard-theme">
html[data-theme="light"] {
  --bg: #f4f7ff; --surface: #ffffff; --border: #d8e2f5;
  --text: #1c2a4a; --muted: #5b6b86; --accent: #1d4ed8;
  --warn: #b45309; --err: #dc2626; --ok: #059669;
}
html[data-theme="light"] body { background: linear-gradient(180deg, #ffffff 0%, #eef4ff 100%); }
html[data-theme="light"] h1 {
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 55%, #93c5fd 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
html[data-theme="light"] .nav { background: rgba(255, 255, 255, 0.94); }
html[data-theme="light"] .mermaid { background: #ffffff; box-shadow: 0 6px 20px rgba(37, 99, 235, 0.10); }
html[data-theme="light"] .mermaid-toolbar { background: rgba(255, 255, 255, 0.95); }
html[data-theme="light"] .mermaid-toolbar button { background: #ffffff; }
html[data-theme="light"] .call-table th { background: #eef4ff; }
html[data-theme="light"] .card { background: #ffffff; }
html[data-theme="light"] code { background: #eef4ff; }
html[data-theme="light"] .arrow-chain { background: rgba(37, 99, 235, 0.08); }
html[data-theme="light"] .tag-async { background: #ede9fe; color: #5b21b6; }
html[data-theme="light"] .tag-class { background: #d1fae5; color: #047857; }
html[data-theme="light"] .tag-func { background: #dbeafe; color: #1d4ed8; }
html[data-theme="light"] .tag-cmd { background: #fef3c7; color: #b45309; }
html[data-theme="light"] .tag-endpoint { background: #fee2e2; color: #b91c1c; }
html[data-theme="light"] .tag-hook { background: #fce7f3; color: #be185d; }
html[data-theme="dark"] h1 {
  background: linear-gradient(135deg, #94a3b8 0%, #38bdf8 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
</style>"""

TREE_THEME_CSS = """<style id="dashboard-theme">
html[data-theme="dark"] body { background: #0f172a; color: #e2e8f0; }
html[data-theme="dark"] h1 { color: #e2e8f0; }
html[data-theme="dark"] #tree-container { background: #1e293b; border-color: #334155; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
html[data-theme="dark"] svg { background: #1e293b; }
html[data-theme="dark"] .link { stroke: #64748b !important; }
html[data-theme="dark"] .node text { fill: #e2e8f0 !important; stroke: #1e293b; }
</style>"""


def run(cmd):
    print("  > %s" % " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True)


def sanitize(html_path):
    if not html_path.is_file():
        return
    text = html_path.read_text(encoding="utf-8")
    text = text.replace(EM_DASH, "-")
    html_path.write_text(text, encoding="utf-8")


def inject_theme(html_path, css):
    if not html_path.is_file():
        return
    text = html_path.read_text(encoding="utf-8")
    text = text.replace(EM_DASH, "-")
    marker = "</head>"
    if marker in text and "dashboard-theme" not in text:
        text = text.replace(marker, css + "\n" + THEME_SCRIPT + "\n" + marker)
    html_path.write_text(text, encoding="utf-8")


def main():
    if not GRAPH_JSON.is_file():
        sys.exit("ERROR: %s not found. Run `graphify extract . --code-only` first." % GRAPH_JSON)
    VIEWS_DIR.mkdir(parents=True, exist_ok=True)

    for label, cmd in (
        ("tree", ["graphify", "tree", "--output", str(VIEWS_DIR / "tree.html"), "--label", ROOT.name]),
        ("callflow", ["graphify", "export", "callflow-html"]),
    ):
        r = run(cmd)
        if r.returncode != 0:
            print("  (%s skipped: %s)" % (label, (r.stderr.strip() or "unknown error").splitlines()[-1]))

    src_graph = ROOT / "graphify-out" / "graph.html"
    if src_graph.is_file():
        shutil.copy2(src_graph, VIEWS_DIR / "graph.html")
        print("Copied %s -> %s" % (src_graph.name, VIEWS_DIR / "graph.html"))

    callflow_candidates = list(ROOT.glob("graphify-out/*-callflow.html"))
    if callflow_candidates:
        shutil.copy2(callflow_candidates[0], VIEWS_DIR / "callflow.html")
        print("Copied %s -> %s" % (callflow_candidates[0].name, VIEWS_DIR / "callflow.html"))

    inject_theme(VIEWS_DIR / "callflow.html", CALLFLOW_THEME_CSS)
    inject_theme(VIEWS_DIR / "tree.html", TREE_THEME_CSS)
    sanitize(VIEWS_DIR / "graph.html")

    print("views in %s:" % VIEWS_DIR)
    for f in sorted(VIEWS_DIR.glob("*.html")):
        print("  %s (%d B)" % (f.name, f.stat().st_size))


if __name__ == "__main__":
    main()
