/* Context section entry point. */

import { bindGrowthControls, selectSessionInContext, renderContextGrowth } from "./growth.js";
import { renderLatest } from "./window.js";
import { renderComposition } from "./composition.js";
import { renderBreakdown } from "./breakdown.js";

export { selectSessionInContext, renderContextGrowth };

export function renderContext(snap) {
  if (!snap) return;
  bindGrowthControls();
  renderLatest(snap);
  renderComposition(snap);
  renderBreakdown(snap);
}
