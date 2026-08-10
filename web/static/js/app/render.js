/* Range switching + active-button state. */

import { state } from "../core/state.js";
import { $all } from "../core/utils.js";
import { loadLiveRange } from "../live/api.js";
import { updateChips } from "../ui/chips.js";

export function updateRangeButtons(rangeKey) {
  $all(".range-btn").forEach(function (b) {
    var on = b.getAttribute("data-range") === rangeKey;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function selectRange(rangeKey) {
  state.range = rangeKey;
  state.page = 1;
  updateRangeButtons(rangeKey);
  loadLiveRange(rangeKey);
  updateChips();
}
