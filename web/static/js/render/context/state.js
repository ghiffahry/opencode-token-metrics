/* Shared state + helpers across the context section modules. */

export var CATEGORY_LABELS = {
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

export function humanCat(c) {
  return CATEGORY_LABELS[c] || c;
}

export function utilClass(pct) {
  if (pct > 90) return "is-critical";
  if (pct >= 75) return "is-warn";
  if (pct >= 50) return "is-mid";
  return "is-ok";
}

export function utilTextClass(cls) {
  return cls === "is-warn" ? "text-warn" : cls === "is-critical" ? "is-danger-text" : "";
}

/* Mutable cross-module state lives in this object (imported bindings are
   read-only in ES modules, so direct var reassignment would throw). */
export var ctxState = {
  bound: false,
  selectedSession: null,
  growthChart: null,
  drawerOpen: false
};
