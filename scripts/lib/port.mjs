/**
 * Local TCP port probing, shared by every launcher that fronts `shopify theme dev`
 * (scripts/theme-dev.mjs, scripts/wt-dev.mjs). The CLI's `--port` takes one fixed
 * number and fails when it is taken, so the "which port is actually free" question
 * has to be answered before we spawn it.
 */
import { createServer } from "node:net";

/** Can we bind this port on localhost right now? */
export function isPortFree(candidate) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(candidate, "127.0.0.1");
  });
}

/**
 * First free port at or above `base`, probing at most `span` candidates.
 * Returns null when the whole window is taken — the caller decides what to say.
 */
export async function findFreePort(base, span = 50) {
  for (let candidate = base; candidate < base + span; candidate += 1) {
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
}
