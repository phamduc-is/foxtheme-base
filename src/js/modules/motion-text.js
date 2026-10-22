import { animate } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import { getMotionPreset, motionPresetForViewport, DEFAULT_PRESET } from "@theme/motion-presets";
import {
  prefersReducedMotion,
  coordinatedInView,
  isMotionMobile,
  motionDurationMs,
  motionToken,
} from "@theme/utilities";

/**
 * @capability Split-text entrance — splits its text into words, each inside its own clipping box, and plays the block's entrance preset (fade-in, fade-up/down, slide-in) on them one after another as the text is scrolled to — a heading cascades as one; a text taller than half the viewport is paced by its lines, each line below the fold waiting until it is scrolled to; the cascade is capped so a long paragraph lands as quickly as a short heading; gradient-filled text (background-clip: text) keeps its colour while the words move; coordinated through motionCoordinator, replayable (replay / exit({ durationMs, easing }), with data-motion-exiting + exitTiming while it leaves) for slides, honours prefers-reduced-motion, and shows the text at once when the animation budget is full.
 * @when Text whose entrance should run word by word. snippets/text-markup.liquid renders it when a text's animation_split is "words" — the effect itself is still the block's animation_type. Offer animation_split on a text block instead of hand-splitting text anywhere else.
 * @contract <motion-text data-motion="<preset>" [data-motion-delay]> wrapping rich text. The preset (motion-presets.js, stepped down for phones like everywhere else) sets each word's movement: a vertical one rises out of the word's own clipping box (90% of its height), a horizontal one travels --motion-split-distance unclipped (data-motion-unmasked), and a fade only fades; zoom kinds fade. Rich text (inline markup inside is kept, <em is="highlight-text"> waits for the words before it sweeps). Timing: --motion-heading-duration, --motion-heading-ease (unset = the entrance curve), --motion-heading-stagger (per word, shrunk so the last word starts within --motion-heading-span), and the block's own data-motion-delay (ms) before the first word — the Delay setting, nothing added on top. Hidden by critical CSS while <html data-motion-text-armed> and the element has no data-motion-split; words are [data-motion-word] > [data-motion-word-inner]; data-initialized once every word has landed (releases the clip). replay({ delay }) — every word at once — and exit() drive it from a host such as a slideshow.
 * @component motion-text
 * @keywords split text, word reveal, heading animation, text reveal, masked words, staggered words, title animation, slide heading
 */
export class MotionText extends HTMLElement {
  /** @type {HTMLElement[]} The animated inner span of every word, in reading order. */
  #words = [];

  /** @type {Set<{ cancel: () => void, finished: Promise<unknown> }>} Every animation running on the words. */
  #controls = new Set();

  /** @type {IntersectionObserver | null} Watches the words still below the fold. */
  #waiting = null;

  /** @type {Set<HTMLElement>} Words whose entrance waits for them to be scrolled to. */
  #pending = new Set();

  /** @type {Map<HTMLElement, number>} When each word's entrance starts (performance.now()). */
  #startsAt = new Map();

  /** @type {(() => void) | null} */
  #inViewStop = null;

  /** Bumped by anything that supersedes a run, so a stale continuation bails. */
  #runId = 0;

  /** @type {{ durationMs: number, easing: string } | null} */
  #exitTiming = null;

  /** @type {Set<MotionText>} Texts connected in this task, set up together. */
  static #queue = new Set();

  /**
   * Every text that connects in one task — all of them at once while the
   * module evaluates on page load — is set up in one batch: every read first
   * (the preset's tokens off the computed style), then every write (the split
   * and the staged words). Done per element, each text's split invalidated the
   * style the next one then read, and the page paid a style recalc per text
   * (measured on a phone: ~12ms of forced layout in motion-text.js at load).
   * A microtask is still before the first paint, and the text stays hidden by
   * critical CSS until it is split.
   *
   * @param {MotionText} text
   */
  static #enqueue(text) {
    if (!MotionText.#queue.size) queueMicrotask(() => MotionText.#flush());
    MotionText.#queue.add(text);
  }

  static #flush() {
    const texts = [...MotionText.#queue].filter((text) => text.isConnected);
    MotionText.#queue.clear();
    const moves = texts.map((text) => {
      try {
        return text.#moves();
      } catch (error) {
        console.error("[motion-text]", error);
        return null;
      }
    });
    texts.forEach((text, index) => {
      // One text failing must not leave the others behind the hide.
      try {
        if (!moves[index]) throw new Error("motion-text: no start state");
        text.#split();
        text.#stage(moves[index]);
        text.#bind();
      } catch (error) {
        console.error("[motion-text]", error);
        text.revealNow();
      }
    });
  }

  connectedCallback() {
    if (this.#isDisabled()) {
      this.revealNow();
      return;
    }
    MotionText.#enqueue(this);
  }

  /**
   * A host reached this text in the same task it connected, before the batch
   * ran (a slideshow replaying its first slide on init): split it now, so the
   * host's call acts on words, and the batch leaves it alone.
   */
  #claimFromBatch() {
    if (MotionText.#queue.delete(this)) this.#split();
  }

  #bind() {
    this.#inViewStop = coordinatedInView(
      this,
      () => (this.isConnected ? this.#enter(0, { scroll: true }) : undefined),
      {
        onSkip: () => this.revealNow(),
      }
    );
  }

  /**
   * After a morph (a section re-rendered in place): the server's markup came
   * back unsplit and the state attributes went with it, so the text would sit
   * behind the critical-CSS hide for good. Split it again and show it — a
   * morph is not an entrance.
   */
  updatedCallback() {
    MotionText.#queue.delete(this);
    this.#runId += 1;
    this.#unbind();
    this.#cancel();
    if (!this.querySelector("[data-motion-word-inner]")) this.removeAttribute("data-motion-split");
    this.#words = [];
    // Motion off never splits (reduced motion, data-motion-off): word boxes are
    // inline-blocks, which would change line breaking for nothing.
    if (!this.#isDisabled()) this.#split();
    this.revealNow();
  }

  disconnectedCallback() {
    MotionText.#queue.delete(this);
    this.#runId += 1;
    this.#unbind();
    this.#cancel();
  }

  /**
   * Play the entrance again — a slide the visitor moved to. `delay` (ms) is
   * added before the block's own delay, so a host can wait for the outgoing
   * heading to clear first.
   *
   * @param {{ delay?: number }} [options]
   * @returns {Promise<void>}
   */
  replay({ delay = 0 } = {}) {
    if (this.#isDisabled()) {
      // Whatever a host's replay finds, it ends with the text visible —
      // including a text that was exited before motion was switched off.
      this.revealNow();
      return Promise.resolve();
    }
    this.#claimFromBatch();
    this.#unbind();
    this.#stage();
    return this.#enter(delay);
  }

  /**
   * The words leave upwards and the clip comes back on, so they leave through
   * the top of their boxes. From the first word at once: the section's heading
   * delay is for arriving, not leaving — counted here, it held the exit back
   * until a fading slide had already taken the words with it. A host that
   * waits on the exit (a slideshow running its swap in sequence) can run it on
   * a shorter clock; the cascade is then held to half that duration so the last
   * word is not left behind. While it runs, data-motion-exiting is set and
   * exitTiming says on what clock — an <em> highlight inside collapses on it.
   *
   * @param {{ durationMs?: number, easing?: string }} [options]
   * @returns {Promise<void>}
   */
  async exit({ durationMs, easing } = {}) {
    if (this.#isDisabled()) return;
    this.#claimFromBatch();
    if (!this.#words.length) return;

    const run = ++this.#runId;
    this.#cancel();
    const timing = this.#timing();
    const duration = durationMs ?? timing.durationMs;
    const count = this.#words.length;
    const step = count > 1 ? Math.min(this.#step(), duration / 2 / (count - 1)) : 0;
    this.#exitTiming = { durationMs: duration + step * (count - 1), easing: easing ?? timing.easing };

    this.setAttribute("data-motion-exiting", "");
    this.removeAttribute("data-initialized");
    this.#paintClippedBackgrounds();

    const { opacity, leave, masked } = this.#moves();
    this.toggleAttribute("data-motion-unmasked", !masked);
    const controls = animate(
      this.#words,
      { opacity: [1, opacity], transform: ["none", leave] },
      { duration: duration / 1000, easing: this.#exitTiming.easing, delay: (index) => (index * step) / 1000 }
    );
    this.#controls.add(controls);

    await controls.finished.catch(() => {});
    this.#controls.delete(controls);
    if (run !== this.#runId) return;
    this.removeAttribute("data-motion-exiting");
  }

  /**
   * The clock of the exit that is running, or ran last: total duration
   * (cascade included) and curve.
   *
   * @returns {{ durationMs: number, easing: string } | null}
   */
  get exitTiming() {
    return this.#exitTiming;
  }

  /**
   * When the words inside `element` have been carried `fraction` of the way
   * through their entrance — the LAST of them, as a performance.now() time — or
   * null while any of them has not started (a line still below the fold). An
   * <em> highlight starts on this, as its own words land, instead of waiting
   * for the whole text to finish.
   *
   * @param {Element} element
   * @param {number} fraction - 0..1 of the per-word duration
   * @returns {number | null}
   */
  landingAt(element, fraction) {
    let last = -Infinity;
    for (const word of this.#words) {
      if (!element.contains(word)) continue;
      const start = this.#startsAt.get(word);
      if (start === undefined) return null;
      last = Math.max(last, start);
    }
    if (last === -Infinity) return null;
    return last + this.#timing().durationMs * fraction;
  }

  /**
   * How long after the first word the last one starts (ms) — what a host waits
   * on, beyond the duration, for this text to clear.
   *
   * @returns {number}
   */
  get cascadeMs() {
    return this.#step() * Math.max(0, this.#words.length - 1);
  }

  /** Show every word in place, now — no budget slot, reduced motion, or a host's call. */
  revealNow() {
    MotionText.#queue.delete(this);
    this.#runId += 1;
    this.#cancel();
    this.#land(this.#words);
    this.removeAttribute("data-motion-exiting");
    this.setAttribute("data-initialized", "true");
  }

  #isDisabled() {
    return (
      prefersReducedMotion() ||
      this.hasAttribute("data-motion-off") ||
      !document.documentElement.hasAttribute("data-motion-text-armed") ||
      this.closest("[data-motion-disabled]") !== null
    );
  }

  /**
   * Wrap every word of every text node — inside links, <strong> and the like
   * too — in a clipping box with an inner span that moves. Whitespace and <br>
   * stay as they were, so the line breaks and the wrapping do not change. A
   * heading the section morphed back in is already split: collect, do not wrap
   * twice.
   */
  #split() {
    if (this.hasAttribute("data-motion-split")) {
      this.#words = Array.from(this.querySelectorAll("[data-motion-word-inner]"));
      return;
    }

    /** @param {Node} node */
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const parts = (child.textContent ?? "").split(/(\s+)/);
          if (!parts.some((part) => part.trim())) continue;

          const fragment = document.createDocumentFragment();
          for (const part of parts) {
            if (!part) continue;
            if (!part.trim()) {
              fragment.append(part);
              continue;
            }
            const word = document.createElement("span");
            word.setAttribute("data-motion-word", "");
            const inner = document.createElement("span");
            inner.setAttribute("data-motion-word-inner", "");
            inner.textContent = part;
            word.append(inner);
            fragment.append(word);
            this.#words.push(inner);
          }
          child.replaceWith(fragment);
        } else if (child.nodeType === Node.ELEMENT_NODE && /** @type {Element} */ (child).tagName !== "BR") {
          walk(child);
        }
      }
    };

    this.#words = [];
    walk(this);
    this.setAttribute("data-motion-split", "");
  }

  /**
   * Every word at the preset's start state.
   *
   * @param {{ opacity: number, start: string, masked: boolean }} [moves] - read beforehand by a batch
   */
  #stage(moves = this.#moves()) {
    this.#runId += 1;
    this.#cancel();
    this.removeAttribute("data-motion-exiting");
    this.removeAttribute("data-initialized");
    const { opacity, start, masked } = moves;
    this.toggleAttribute("data-motion-unmasked", !masked);
    for (const word of this.#words) {
      word.style.opacity = String(opacity);
      word.style.transform = start;
    }
  }

  /**
   * The preset as it applies to ONE word. Its distances are multiples of
   * --motion-distance, sized for a block — a word travelling 3rem would leave
   * the line — so only the direction is kept: a vertical move becomes 90% of
   * the word's height inside its clipping box (the word rises out from under
   * its own baseline), a horizontal one --motion-split-distance with the clip
   * off (clipped sideways it would read as a wipe, not a move). `leave` carries
   * on the way the word came in. A preset that neither fades nor moves (a zoom)
   * fades: a scale per word is a lot of layers for very little.
   *
   * @returns {{ opacity: number, start: string, leave: string, masked: boolean }}
   */
  #moves() {
    const name = motionPresetForViewport(this.dataset.motion || DEFAULT_PRESET, isMotionMobile());
    const from = (getMotionPreset(name) ?? getMotionPreset(DEFAULT_PRESET))?.from ?? {};
    const x = Math.sign(from.x ?? 0);
    const y = Math.sign(from.y ?? 0);
    const fades = from.opacity != null && from.opacity < 1;
    const across = motionToken("--motion-split-distance", "0.5em", this);
    const flip = getComputedStyle(this).getPropertyValue("--flip-x-factor").trim() || "1";

    /** @param {1 | -1} sign */
    const offset = (sign) => {
      const parts = [];
      if (x) parts.push(`translateX(calc(${across} * ${x * sign} * ${flip}))`);
      if (y) parts.push(`translateY(${y * sign * 90}%)`);
      return parts.join(" ") || "none";
    };

    return { opacity: fades || (!x && !y) ? 0 : 1, start: offset(1), leave: offset(-1), masked: y !== 0 };
  }

  /**
   * Play the entrance. A host's replay (a slide, a tab) and any text no taller
   * than half the viewport — every ordinary heading — run every word in one
   * cascade. From a scroll (`scroll: true`, the in-view trigger), a TALLER text
   * is paced by its lines: only the words already on screen start now; a line
   * still below the fold waits until it is scrolled to, and its words cascade
   * among themselves after the block's own delay, like the first line's.
   * Without the pacing a long paragraph ran the moment its first line
   * appeared, and its last lines had landed long before the visitor reached
   * them. Applied to a two-line heading it did the opposite: the second line,
   * a line-height below the fold, waited, then ran at once while still at the
   * very bottom edge — mostly done before anyone looked — while the first
   * line was still in its delay, so the heading read as one line moving and
   * one already there.
   *
   * Resolves when the words that started now have landed — the budget slot the
   * coordinator holds is for those; the later lines run outside it, one short
   * cascade at a time. data-initialized is set once every word has landed.
   *
   * @param {number} [extraDelay] - ms before the block's own delay
   * @param {{ scroll?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async #enter(extraDelay = 0, { scroll = false } = {}) {
    if (!this.#words.length) {
      this.revealNow();
      return;
    }

    const run = ++this.#runId;

    // Measure before anything is written: #paintClippedBackgrounds() writes
    // styles, and a rect read after it would force a style recalc.
    let now = this.#words;
    const fold = window.innerHeight;
    if (scroll && this.getBoundingClientRect().height > fold / 2) {
      // The clipping box, not the moving word: it never carries a transform,
      // so it measures where the word will land.
      now = this.#words.filter(
        (word) => /** @type {HTMLElement} */ (word.parentElement).getBoundingClientRect().top < fold
      );
      if (!now.length) now = this.#words;
      if (now.length < this.#words.length) {
        const started = new Set(now);
        this.#waitForScroll(
          this.#words.filter((word) => !started.has(word)),
          run
        );
      }
    }

    this.#paintClippedBackgrounds();
    await this.#play(now, extraDelay + (Number(this.dataset.motionDelay) || 0), run);
    this.#settle(run);
  }

  /**
   * Watch the words below the fold, by their clipping boxes, and start each
   * batch the moment it is scrolled into view. If the text leaves through the
   * top with words still waiting — a fast fling past it, or a word the
   * observer never reports — they run then, so none is left hidden.
   *
   * @param {HTMLElement[]} words
   * @param {number} run
   */
  #waitForScroll(words, run) {
    this.#pending = new Set(words);
    const boxes = new Map(words.map((word) => [/** @type {Element} */ (word.parentElement), word]));
    const order = new Map(this.#words.map((word, index) => [word, index]));

    const observer = new IntersectionObserver((entries) => {
      if (run !== this.#runId) return;
      /** @type {HTMLElement[]} */
      let arrived = [];
      for (const entry of entries) {
        if (entry.target === this) {
          if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) arrived = [...this.#pending];
          continue;
        }
        const word = boxes.get(entry.target);
        if (entry.isIntersecting && word && this.#pending.has(word)) arrived.push(word);
      }
      if (!arrived.length) return;

      arrived.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      for (const word of arrived) {
        this.#pending.delete(word);
        observer.unobserve(/** @type {Element} */ (word.parentElement));
      }
      this.#play(arrived, Number(this.dataset.motionDelay) || 0, run).then(() => this.#settle(run));
    });

    for (const box of boxes.keys()) observer.observe(box);
    observer.observe(this);
    this.#waiting = observer;
  }

  /**
   * One cascade over `words`, then each is put back to its resting style.
   *
   * @param {HTMLElement[]} words
   * @param {number} startMs
   * @param {number} run
   * @returns {Promise<void>}
   */
  async #play(words, startMs, run) {
    const { durationMs, easing, step } = this.#timing();
    const { opacity, start } = this.#moves();
    const now = performance.now();
    words.forEach((word, index) => this.#startsAt.set(word, now + startMs + index * step));
    const controls = animate(
      words,
      { opacity: [opacity, 1], transform: [start, "none"] },
      { duration: durationMs / 1000, easing, delay: (index) => (startMs + index * step) / 1000 }
    );
    this.#controls.add(controls);
    this.dispatchEvent(
      new CustomEvent(ThemeEvents.motionStart, { bubbles: true, detail: { preset: this.dataset.motion } })
    );

    await controls.finished.catch(() => {});
    this.#controls.delete(controls);
    if (run !== this.#runId) return;
    this.#land(words);
  }

  /** @param {number} run */
  #settle(run) {
    if (run !== this.#runId || this.#pending.size || this.#controls.size) return;
    this.#waiting?.disconnect();
    this.#waiting = null;
    this.setAttribute("data-initialized", "true");
  }

  /**
   * Words at rest: no inline start state, and no borrowed gradient — once a
   * word stops moving, the owner's own clipped background reaches it again.
   *
   * @param {HTMLElement[]} words
   */
  #land(words) {
    for (const word of words) {
      word.style.opacity = "";
      word.style.transform = "";
    }
    this.#unpaintClippedBackgrounds(words);
  }

  /**
   * Gradient text is a background clipped to the glyphs of the element that
   * owns it (`background-clip: text`, with transparent text). A word with a
   * transform is painted on its own layer, outside that clip — so a moving word
   * shows neither its colour nor the gradient: the text is simply gone until it
   * lands. While the words move, each one carries the owner's background
   * itself, sized to the owner's box and shifted by the word's offset inside
   * it, so the gradient still runs across the words as one. Measured from the
   * word's clipping box, which never moves, so a word already staged or still
   * mid-exit measures the same as one at rest.
   */
  #paintClippedBackgrounds() {
    /** @type {Map<Element, CSSStyleDeclaration | null>} */
    const owners = new Map();
    /** @param {Element} el */
    const clipOwner = (el) => {
      if (!owners.has(el)) {
        const style = getComputedStyle(el);
        const clip = style.backgroundClip || style.getPropertyValue("-webkit-background-clip");
        owners.set(el, clip === "text" ? style : null);
      }
      return owners.get(el);
    };

    // Every read first, then every write: a style written on one word would
    // otherwise force a recalc for the next word's measurements.
    /** @type {[HTMLElement, Record<string, string>][]} */
    const paints = [];
    for (const word of this.#words) {
      const box = /** @type {HTMLElement} */ (word.parentElement);
      /** @type {Element | null} */
      let owner = box.parentElement;
      while (owner && !clipOwner(owner)) owner = owner === this ? null : owner.parentElement;
      if (!owner) continue;

      const style = /** @type {CSSStyleDeclaration} */ (owners.get(owner));
      const area = owner.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      const boxStyle = getComputedStyle(box);
      const left = rect.left + parseFloat(boxStyle.borderLeftWidth) + parseFloat(boxStyle.paddingLeft);
      const top = rect.top + parseFloat(boxStyle.borderTopWidth) + parseFloat(boxStyle.paddingTop);

      paints.push([
        word,
        {
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${area.width}px ${area.height}px`,
          backgroundPosition: `${area.left - left}px ${area.top - top}px`,
          backgroundClip: "text",
          webkitBackgroundClip: "text",
          color: "transparent",
        },
      ]);
    }
    for (const [word, paint] of paints) Object.assign(word.style, paint);
  }

  /**
   * Back to the owner's own clipped background, which follows any later reflow.
   *
   * @param {HTMLElement[]} words
   */
  #unpaintClippedBackgrounds(words) {
    for (const word of words) {
      if (!word.style.backgroundClip) continue;
      for (const property of [
        "background-image",
        "background-color",
        "background-repeat",
        "background-size",
        "background-position",
        "background-clip",
        "-webkit-background-clip",
        "color",
      ]) {
        word.style.removeProperty(property);
      }
    }
  }

  /** @returns {{ durationMs: number, easing: string, step: number }} */
  #timing() {
    const entrance = motionToken("--motion-ease-entrance", "cubic-bezier(0.16, 1, 0.3, 1)", this);
    return {
      durationMs: motionDurationMs("--motion-heading-duration", 1000, this),
      easing: motionToken("--motion-heading-ease", entrance, this),
      step: this.#step(),
    };
  }

  /**
   * The per-word step, shrunk when the words would take longer than
   * --motion-heading-span to all get going: a paragraph of 200 words at 30ms is
   * six seconds of cascade. Short headings keep the full step.
   */
  #step() {
    const stagger = motionDurationMs("--motion-heading-stagger", 30, this);
    const span = motionDurationMs("--motion-heading-span", 600, this);
    return this.#words.length > 1 ? Math.min(stagger, span / (this.#words.length - 1)) : stagger;
  }

  #cancel() {
    this.#startsAt.clear();
    for (const controls of this.#controls) controls.cancel();
    this.#controls.clear();
    this.#waiting?.disconnect();
    this.#waiting = null;
    this.#pending.clear();
  }

  #unbind() {
    this.#inViewStop?.();
    this.#inViewStop = null;
  }
}

if (!customElements.get("motion-text")) {
  customElements.define("motion-text", MotionText);
}

// Tells the boot watchdog (snippets/motion-boot.liquid) this half of the
// runtime arrived, so it keeps the heading prestage armed.
document.documentElement.setAttribute("data-motion-text-booted", "");
