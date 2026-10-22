/**
 * @capability Thin wrapper over the User Timing API — namespaced performance.mark/measure pairs for benchmarking theme operations; ships the cartPerformance singleton (metrics prefixed "cart-performance:") intended for timing cart mutations.
 * @when Instrumenting how long an operation takes so it shows up in the DevTools Performance panel or a PerformanceObserver — especially cart flows; reuse cartPerformance rather than hand-writing performance.mark strings. No @theme/* alias — currently unreferenced plumbing (usages are commented out), import it directly if you need it.
 * @contract import { cartPerformance } from "./performance.js"; cartPerformance.measure(name, callback) for sync spans, measureFromEvent(name, event) to close a span opened by createStartingMarker(name), or measureFromMarker(marker).
 * @keywords performance, benchmark, user timing, performance.mark, performance.measure, cart performance, metrics, instrumentation, timing
 */
class ThemePerformance {
  /**
   * @param {string} metricPrefix
   */
  constructor(metricPrefix) {
    this.metricPrefix = metricPrefix;
  }

  /**
   * @param {string} benchmarkName
   * @returns {PerformanceMark}
   */
  createStartingMarker(benchmarkName) {
    const metricName = `${this.metricPrefix}:${benchmarkName}`;
    return performance.mark(`${metricName}:start`);
  }

  /**
   * @param {string} benchmarkName
   * @param {Event} event
   * @returns {void}
   */
  measureFromEvent(benchmarkName, event) {
    const metricName = `${this.metricPrefix}:${benchmarkName}`;

    performance.mark(`${metricName}:end`);

    performance.measure(metricName, `${metricName}:start`, `${metricName}:end`);
  }

  /**
   * @param {PerformanceMark} startMarker
   * @returns {void}
   */
  measureFromMarker(startMarker) {
    const metricName = startMarker.name.replace(/:start$/, "");
    const endMarker = performance.mark(`${metricName}:end`);

    performance.measure(metricName, startMarker.name, endMarker.name);
  }

  /**
   * @param {string} benchmarkName
   * @param {Function} callback
   * @returns {void}
   */
  measure(benchmarkName, callback) {
    const metricName = `${this.metricPrefix}:${benchmarkName}`;
    performance.mark(`${metricName}:start`);

    callback();

    performance.mark(`${metricName}:end`);

    performance.measure(benchmarkName, `${metricName}:start`, `${metricName}:end`);
  }
}

export const cartPerformance = new ThemePerformance("cart-performance");
