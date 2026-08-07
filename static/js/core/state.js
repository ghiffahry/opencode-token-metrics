/* Singleton mutable state shared across all modules. */

export var state = {
  range: "today",
  view: null,
  page: 1,
  pageSize: 10,
  modelFilter: "all",
  agentFilter: "all",
  modelSearch: "",
  requestSearch: "",
  sort: { key: "total", dir: "desc" },
  live: { input: 0, output: 0, streamIn: [], streamOut: [], streamLabels: [] },
  liveMode: true,
  liveRealtime: null,
  liveRequests: [],
  liveContext: {},
  liveDefaultContext: 200000,
  liveSessionSnapshot: {},
  liveFailCount: 0,
  liveHealthOk: false,
  liveNextFull: 0,
  liveLoadSequence: 0,
  project: "(unknown)",
  projects: [],
  customFrom: "",
  customTo: "",
  contextUsage: null,
  budget: null,
  contextView: "model",
  livePaused: false,
  liveWindow: 60,
  lastSyncAt: 0
};

export var liveRangeCache = new Map();
export var liveContextCache = new Map();
export var liveBudgetCache = new Map();

export var chartRegistry = { generation: null, api: null, usage: null, stages: null, realtime: null, sparks: {} };
