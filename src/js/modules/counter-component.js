import { Component } from "@theme/component";
import { prefersReducedMotion, ResizeNotifier } from "@theme/utilities";
import { inView } from "@theme/animation";

/**
 * @capability Animated count-up number — eases (easeOutExpo) from 0 to a target value over 2s when scrolled into view, with thousands/decimal separator formatting, layout-shift-free width reservation, and reduced-motion fallback to the final value.
 * @when Statistics rows, "10,000+ customers" milestone blocks, achievements/KPI highlights — any number that should animate up when it enters the viewport.
 * @contract <counter-component data-target="..." [data-thousands-sep] [data-decimal-sep]> with required refs numberDisplay (animated text) and numberPlaceholder (hidden final value that reserves width).
 * @keywords count up, animated number, counter, statistics, stats, milestones, number ticker, increment animation, in-view counter
 */
class CounterComponent extends Component {
  requiredRefs = ["numberDisplay", "numberPlaceholder"];

  #inViewStop = null;
  #endVal = 0;
  #thousandsSep = ",";
  #decimalSep = ".";
  #decimalPlaces = 0;
  #durationMs = 2000;
  #rAF = null;
  #startTime = null;
  #resizer = null;

  /** easeOutExpo: t, b, c, d */
  static #easeOutExpo(t, b, c, d) {
    return (c * (-Math.pow(2, (-10 * t) / d) + 1) * 1024) / 1023 + b;
  }

  connectedCallback() {
    super.connectedCallback();

    const endVal = parseFloat(this.dataset.target, 10);
    if (Number.isNaN(endVal) || endVal < 0) return;

    this.#endVal = endVal;
    this.#thousandsSep = this.dataset.thousandsSep ?? ",";
    this.#decimalSep = this.dataset.decimalSep ?? ".";
    this.#decimalPlaces = endVal % 1 !== 0 ? 2 : 0;

    this.#init();

    // Measure the placeholder (the natural text width), write min-width to the host: one-way, so
    // observing never sees a width this component itself produced.
    this.#resizer = new ResizeNotifier(([entry]) => {
      this.style.minWidth = `${entry.contentRect.width}px`;
    });
    this.#resizer.observe(this.refs.numberPlaceholder);

    this.#inViewStop = inView(this, () => this.#start(), { margin: "0px", amount: 0.1 });
  }

  disconnectedCallback() {
    this.#resizer?.disconnect();
    this.#resizer = null;
    this.#inViewStop?.();
    this.#inViewStop = null;
    if (this.#rAF != null) cancelAnimationFrame(this.#rAF);
    this.#rAF = null;
    super.disconnectedCallback();
  }

  #init() {
    const { numberPlaceholder } = this.refs;

    requestAnimationFrame(() => {
      numberPlaceholder.textContent = this.#formatValue(this.#endVal);
      this.style.minWidth = `${numberPlaceholder.offsetWidth}px`;
    });
  }

  #formatValue(val) {
    const neg = val < 0 ? "-" : "";
    const fixed = Math.abs(val).toFixed(this.#decimalPlaces);
    const parts = fixed.split(".");
    let intPart = parts[0];
    const decPart = parts.length > 1 ? this.#decimalSep + parts[1] : "";
    if (this.#thousandsSep !== "") {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, this.#thousandsSep);
    }
    return neg + intPart + decPart;
  }

  #printValue(val) {
    const { numberDisplay } = this.refs;
    numberDisplay.textContent = this.#formatValue(val);
  }

  #count(timestamp) {
    if (!this.#startTime) this.#startTime = timestamp;
    const progress = timestamp - this.#startTime;
    const frameVal = CounterComponent.#easeOutExpo(progress, 0, this.#endVal, this.#durationMs);
    const clamped = Math.min(frameVal, this.#endVal);
    const rounded = Number(clamped.toFixed(this.#decimalPlaces));
    this.#printValue(rounded);

    if (progress < this.#durationMs) {
      this.#rAF = requestAnimationFrame(this.#count.bind(this));
    } else {
      this.#printValue(this.#endVal);
      this.#rAF = null;
    }
  }

  #start() {
    if (prefersReducedMotion()) {
      this.#printValue(this.#endVal);
      return;
    }
    this.#startTime = null;
    this.#rAF = requestAnimationFrame(this.#count.bind(this));
  }
}

customElements.define("counter-component", CounterComponent);
