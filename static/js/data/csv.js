/* Browser-side CSV export of the current view. */

import { state } from "../core/state.js";
import { getFilteredRequests } from "../render/tables.js";

export function exportCSV() {
  var view = state.view;
  var lines = [];
  lines.push("Section,Model/Date,Requests,Input,Output,Total,Errors,SuccessRate,Latency");
  view.models.forEach(function (m) {
    var rate = ((m.requests - m.errors) / m.requests * 100).toFixed(2);
    lines.push(["Model", m.name, m.requests, m.input, m.output, m.input + m.output, m.errors, rate + "%", m.latency].join(","));
  });
  lines.push("");
  lines.push("Section,Date,Requests,Input,Output,Total");
  view.tableRows.forEach(function (r) {
    lines.push(["Day", r.label, r.requests, r.input, r.output, r.input + r.output].join(","));
  });
  lines.push("");
  lines.push("Section,Request,Model,Agent,Input,Output,Total,Latency,Status,Time");
  getFilteredRequests().forEach(function (r) {
    lines.push(["Request", r.id, r.model, r.agent, r.input, r.output, r.total, r.latency, r.status, r.time.toISOString()].join(","));
  });

  var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "token-metrics-" + state.range + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
}
