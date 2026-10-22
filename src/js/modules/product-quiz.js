import { Component } from "@theme/component";
import { DialogOpenEvent } from "@theme/dialog";
import { sectionRenderer } from "@theme/section-renderer";
import { prefersReducedMotion } from "@theme/utilities";

const ENDPOINT_ID = "section-rendering-product-quiz";
const AUTO_ADVANCE_DELAY = 250;
const MAX_RESULTS = 12;
/** Ids per search request: the endpoint renders at most 12 rows, so a chunk never loses one. */
const IDS_PER_REQUEST = 12;
const MAX_ID_REQUESTS = 3;
const STORAGE_PREFIX = "product-quiz:";
/** Query param our `return_to` carries back, so a restore is scoped to THIS quiz. */
const RETURN_PARAM = "product_quiz";
/**
 * Shopify's availability filter; `=1` keeps in-stock products only. Sent on EVERY Finder request:
 * Shopify ignores a `filter.*` param the collection does not expose, so it is safe everywhere.
 */
const AVAILABILITY_PARAM = "filter.v.availability";
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @typedef {object} Answer
 * @property {string} value - The radio value (option block id, or `auto:<filter value>`).
 * @property {string} label - Shopper-facing answer text (summary, tokens, customer tags).
 * @property {string} filterValue - Store-filter value this answer applies ('' = none).
 * @property {string[]} strong - Product ids recommended first (product-list mode).
 * @property {string[]} partial - Product ids recommended after every strong match.
 * @property {string[]} exclude - Product ids removed from the results.
 * @property {string[]} skip - Question ids this answer removes from the flow.
 * @property {boolean} noPreference - Applies no filter and no products.
 */

/**
 * @typedef {object} Refs
 * @property {HTMLElement} [live] - Polite live region ("Question n of N", email / results heading).
 * @property {HTMLElement} [intro] - Intro screen (static block, optional).
 * @property {HTMLElement} [progress] - Progress wrapper (bar or stepper).
 * @property {HTMLElement} [progressLabel] - "Question n of N" above the bar.
 * @property {HTMLElement[]} [progressSteps] - One step per question, document order.
 * @property {HTMLElement[]} [questions] - Question panels, document order.
 * @property {HTMLElement} [email] - Email screen (static block, optional).
 * @property {HTMLInputElement} [emailInput]
 * @property {HTMLInputElement} [emailTags]
 * @property {HTMLInputElement} [emailReturnTo]
 * @property {HTMLElement} [emailError]
 * @property {HTMLButtonElement} [emailSubmit]
 * @property {HTMLTemplateElement} [discountTemplate]
 * @property {HTMLElement} [results] - Results screen (static block).
 * @property {HTMLElement} [resultsHeading]
 * @property {HTMLElement} [resultsDescription]
 * @property {HTMLElement} [resultsSummary]
 * @property {HTMLElement} [resultsDiscount]
 * @property {HTMLElement} [resultsLoading]
 * @property {HTMLElement} [resultsEmpty]
 * @property {HTMLElement} [resultsError]
 * @property {HTMLElement} [resultsList]
 * @property {HTMLTemplateElement} [rowTemplate]
 */

/**
 * @capability Multi-step product quiz / finder wizard — intro → one question per screen (radio cards) → optional email capture (customer form + answer tags, native submit so Shopify's hCaptcha runs; answers kept in sessionStorage and restored on return) → recommended product rows; bar or stepper progress, per-option branching (skip questions), two result sources (store-filter cascade over one collection with live option counts, or per-option strong/partial/exclude product lists), fallback products, [question_id] tokens + answer summary, theme-editor block-select.
 * @when Any "find the right product" questionnaire or guided selling flow. Reuse one of the two sections and restyle it: sections/finder-quiz.liquid (store-filter cascade, data-results-source="filter") or sections/recommendation-quiz.liquid (per-option product lists, data-results-source="products"); both share snippets/product-quiz-shell.liquid + product-quiz-question-markup + product-quiz-option-markup. Do not hand-roll a wizard. The data endpoint is sections/section-rendering-product-quiz.liquid; styles in src/scss/scoped/product-quiz.scss.
 * @contract <product-quiz data-section-id data-results-source="filter|products" data-advance-mode="button|auto" data-results-limit data-collection-url data-search-url data-next-label data-results-label data-progress-template data-animations> with refs live, progress, progressLabel, progressSteps[], questions[] (panels carrying data-question-id / data-filter / data-option-source / data-radio-name), intro, email, results (+ its resultsHeading, resultsList, rowTemplate…); option radios carry data-label / data-filter-value / data-strong / data-partial / data-exclude / data-skip-questions / data-no-preference and bind on:change/on:click/on:keydown="product-quiz/…".
 * @keywords quiz, product quiz, product finder, guided selling, questionnaire, wizard, multi step form, stepper, progress bar, recommendation, part finder, radio cards, lead capture
 * @extends {Component<Refs>}
 */
class ProductQuiz extends Component {
  /** @type {AbortController} */
  #abortController = new AbortController();
  /** @type {Map<string, Answer[]>} Answers per question id; `[]` = skipped by the shopper. */
  #answers = new Map();
  /** @type {Set<string>} Questions the store filter left without a single option. */
  #unavailable = new Set();
  /**
   * @type {Set<string>} The ones among them empty for EVERY shopper: found empty in a response no
   * answer narrowed. They never count in the progress; the others do, shown as skipped.
   */
  #emptyForAll = new Set();
  /** @type {HTMLElement | null} */
  #current = null;
  /** @type {Map<string, Promise<Document>>} */
  #cache = new Map();
  /**
   * Every store filter's param name and value spellings, learned from EVERY collection response
   * (filtered or not), so answers can be turned into `filter.*` params without a separate request.
   * @type {{ params: Map<string, string>, values: Map<string, Map<string, string>> }}
   */
  #filterIndex = { params: new Map(), values: new Map() };
  /** True once a collection response has been read into `#filterIndex`. */
  #indexed = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #autoTimer;
  #arrowNavigation = false;
  #busy = false;
  #emailSubmitted = false;
  /** True while our own `requestSubmit()` is in flight, so `#onEmailSubmit` lets it through. */
  #nativeSubmit = false;
  /** @type {(() => void) | null} */
  #retryAction = null;
  /** Bumped per results load (and by Retake) so a late response never paints a stale run. */
  #resultsRun = 0;
  /** Bumped per answer change (and by Retake) so a late look-ahead never marks a stale flow. */
  #lookaheadRun = 0;
  /**
   * Theme editor only: the bare Finder collection response every filter-driven question is
   * previewed from (see `#editorPreview`). One per element instance, i.e. per editor render.
   * @type {Promise<Document> | null}
   */
  #editorBase = null;

  connectedCallback() {
    super.connectedCallback();

    // Recreated on every connect: the theme editor re-inserts the section on shopify:section:load.
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    // Capture: runs before any submit listener the platform binds to the form (hCaptcha).
    this.#form?.addEventListener("submit", this.#onEmailSubmit, { capture: true, signal });
    // The Continue spinner is visual only and must never outlive a post that did not navigate:
    //   - back from the bfcache after the native post (`pageshow`);
    //   - the shopper dismissed the hCaptcha challenge. It runs in an iframe, so closing it hands
    //     focus back to this window (`focus`), or the tab comes back (`visibilitychange`);
    //   - the shopper returns to the email field to edit it (`focusin` / `input`).
    const clearEmailBusy = () => this.#setEmailBusy(false);
    window.addEventListener("pageshow", clearEmailBusy, { signal });
    window.addEventListener("focus", this.#onWindowFocus, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") clearEmailBusy();
      },
      { signal }
    );
    /** @param {Event} event */
    const onEmailField = (event) => {
      if (event.target === this.refs.emailInput) clearEmailBusy();
    };
    this.addEventListener("focusin", onEmailField, { signal });
    this.addEventListener("input", onEmailField, { signal });

    if (/** @type {any} */ (window).Shopify?.designMode) {
      // Platform event, not a ThemeEvents constant (same as maps.js / carousel.js).
      this.addEventListener("shopify:block:select", this.#onBlockSelect, { signal });
      // Every setting change re-renders the section (`shopify:section:load` inserts a NEW element,
      // so this runs again with empty state). Preview every filter-driven question at once.
      // Before `#begin`, so the intro-off Q1 pre-fetch shares this request instead of racing it.
      this.#editorPreview();
    }

    this.#renderResultsCopy(false);
    if (this.#restore()) return;

    // No intro: the first question is the landing screen (already visible from the server). In the
    // Finder quiz this is also its one pre-fetch (see `#needsPreparing`).
    if (!this.refs.intro) this.#begin({ focus: false });
  }

  disconnectedCallback() {
    this.#abortController.abort();
    clearTimeout(this.#autoTimer);
    super.disconnectedCallback();
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  get #mode() {
    return this.dataset.resultsSource === "filter" ? "filter" : "products";
  }

  get #autoAdvance() {
    return this.dataset.advanceMode === "auto";
  }

  get #limit() {
    const limit = Number.parseInt(this.dataset.resultsLimit ?? "", 10);
    return Math.min(Math.max(Number.isFinite(limit) ? limit : 3, 1), MAX_RESULTS);
  }

  get #designMode() {
    return Boolean(/** @type {any} */ (window).Shopify?.designMode);
  }

  get #storageKey() {
    return `${STORAGE_PREFIX}${this.dataset.sectionId ?? ""}`;
  }

  /** @returns {HTMLElement[]} */
  get #questions() {
    const { questions } = this.refs;
    if (!questions) return [];
    return Array.isArray(questions) ? questions : [questions];
  }

  /** @returns {HTMLElement[]} */
  get #steps() {
    const { progressSteps } = this.refs;
    if (!progressSteps) return [];
    return Array.isArray(progressSteps) ? progressSteps : [progressSteps];
  }

  /** @returns {HTMLElement[]} Every screen, document order. */
  get #screens() {
    const { intro, email, results } = this.refs;
    return /** @type {HTMLElement[]} */ ([intro, ...this.#questions, email, results].filter(Boolean));
  }

  /** @returns {HTMLFormElement | null} */
  get #form() {
    return this.refs.email?.querySelector("form") ?? null;
  }

  // ── Flow ────────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} panel
   * @returns {string}
   */
  #id(panel) {
    return panel.dataset.questionId ?? "";
  }

  /**
   * The questions the shopper will actually see, in order: every question minus the ones an
   * earlier answer skips (`skip_questions`) and the ones the store filter emptied.
   * @returns {HTMLElement[]}
   */
  #flow() {
    return this.#progressFlow().filter((panel) => !this.#unavailable.has(this.#id(panel)));
  }

  /**
   * The questions the progress counts: every question minus the ones an earlier answer skips
   * (`skip_questions`, a branch the merchant designed, so the total follows the shopper's path)
   * and the ones empty for every shopper. A question an earlier ANSWER emptied stays in, as a
   * skipped step, so the total does not shrink mid-quiz.
   * @returns {HTMLElement[]}
   */
  #progressFlow() {
    /** @type {Set<string>} */
    const skipped = new Set();
    const flow = [];
    for (const panel of this.#questions) {
      const id = this.#id(panel);
      if (skipped.has(id) || this.#emptyForAll.has(id)) continue;
      flow.push(panel);
      for (const answer of this.#answers.get(id) ?? []) {
        for (const target of answer.skip) skipped.add(target);
      }
    }
    return flow;
  }

  /**
   * @param {HTMLElement} panel
   * @returns {boolean}
   */
  #hasAnswer(panel) {
    return (this.#answers.get(this.#id(panel))?.length ?? 0) > 0;
  }

  /**
   * Show the first question (after preparing it when its options come from the store filter).
   * @param {{ focus: boolean }} options
   */
  async #begin({ focus }) {
    await this.#advanceFrom(null, focus);
  }

  /**
   * Move to the question after `panel` (or the first one when `panel` is null), preparing each
   * candidate in store-filter mode and dropping the ones the filter leaves empty.
   * @param {HTMLElement | null} panel
   * @param {boolean} [focus]
   * @param {boolean} [auto] - Called by auto-advance: when every later question turns out to be
   *   empty, `panel` became the last one and must wait for its results button instead.
   */
  async #advanceFrom(panel, focus = true, auto = false) {
    clearTimeout(this.#autoTimer);

    for (;;) {
      const flow = this.#flow();
      const index = panel ? flow.indexOf(panel) : -1;
      const next = flow[index + 1];

      if (!next) {
        if (auto && panel) {
          if (panel === this.#current) this.#updateQuestionUi(panel);
          return;
        }
        this.#finish();
        return;
      }

      if (this.#mode === "filter" && this.#needsPreparing(next)) {
        // Starting (no `panel`): the spinner goes on the intro's Start button while the intro is
        // still the visible screen, else on the first question's own button.
        const { intro } = this.refs;
        const busyHost = !panel && intro && !intro.hidden ? intro : panel ?? next;
        const outcome = await this.#run(
          panel ?? next,
          () => this.#prepare(next),
          () => this.#advanceFrom(panel, true),
          busyHost
        );
        // Intro off: the server rendered the first question's cards in a loading state, so no
        // card the store filter is about to hide can flash. Reveal them now — filtered, or as they
        // are (unfiltered) when the pre-fetch failed and the inline retry shows.
        if (!panel) this.#revealOptions(next);
        if (outcome === "error") {
          // Starting failed: show the first question anyway, it carries the inline retry.
          if (!panel) this.#showQuestion(next, { focus });
          return;
        }
        if (outcome === "empty") {
          this.#unavailable.add(this.#id(next));
          continue;
        }
      }

      this.#showQuestion(next, { focus });
      return;
    }
  }

  /**
   * Store-filter mode prepares every filter-driven question before showing it, the first one
   * included: that is the Finder quiz's ONE pre-fetch, on Start (intro on) or on load (intro off),
   * which hides the first question's cards that match no product (in-stock products only) and
   * learns the filter index from the same response. Each later answer then costs exactly one request
   * (`#lookahead`), which the Next click reuses.
   * @param {HTMLElement} target
   */
  #needsPreparing(target) {
    return Boolean((target.dataset.filter ?? "").trim()); // not filter-driven: nothing to narrow
  }

  /**
   * End the server-rendered loading state of a question's cards (see `product-quiz-shell`). The
   * cards stayed in layout under the spinner (`data-quiz-loading` = `visibility: hidden`, plus
   * `aria-hidden` / `inert`), so the swap does not move anything; cards the cascade hid are
   * `hidden` (display: none) by now and take no space.
   * @param {HTMLElement} panel
   */
  #revealOptions(panel) {
    /** @type {HTMLElement | null} */
    const loading = panel.querySelector("[data-quiz-prefetch]");
    if (!loading || loading.hidden) return;
    loading.hidden = true;
    /** @type {HTMLElement | null} */
    const options = panel.querySelector("[data-quiz-options]");
    if (options) {
      options.removeAttribute("data-quiz-loading");
      options.removeAttribute("aria-hidden");
      options.inert = false;
    }
    panel.querySelector("[data-quiz-fieldset]")?.setAttribute("aria-busy", "false");
  }

  #finish() {
    const { email } = this.refs;
    if (email && !this.#emailSubmitted) {
      this.#showScreen(email, { focus: true });
      this.#announce(this.#headingText(email));
      return;
    }
    this.#showResults();
  }

  // ── Public handlers (bound declaratively via on:*="product-quiz/…") ─────────

  /**
   * Bound on the intro's `[data-quiz-start]` wrapper around the static `_product-quiz-start-button`
   * block, so it only reacts to a click on that button (not the wrapper's own box). Start is an
   * action: should an `<a>` ever land there, its link is not followed.
   * @param {MouseEvent} event - Proxied by Component: `target` is the wrapper.
   */
  start(event) {
    const wrapper = /** @type {HTMLElement} */ (event.target);
    const button = this.#startButton(wrapper);
    const origin = event.composedPath()[0];
    if (!button || !(origin instanceof Node) || !button.contains(origin)) return;
    if (button instanceof HTMLAnchorElement) event.preventDefault();
    if (this.#busy) return;
    this.#begin({ focus: true });
  }

  next() {
    const panel = this.#current;
    if (!panel || this.#busy) return;
    if (!this.#hasAnswer(panel)) return; // aria-disabled guard: focus stays on the button
    this.#advanceFrom(panel);
  }

  back() {
    const panel = this.#current;
    if (!panel || this.#busy) return;
    clearTimeout(this.#autoTimer);
    const flow = this.#flow();
    const previous = flow[flow.indexOf(panel) - 1];
    if (previous) this.#showQuestion(previous, { focus: true });
  }

  skip() {
    const panel = this.#current;
    if (!panel || this.#busy) return;
    const id = this.#id(panel);
    const previous = this.#answers.get(id);
    if (!previous || previous.length) this.#clearAfter(panel);
    for (const input of this.#inputs(panel)) input.checked = false;
    this.#answers.set(id, []);
    this.#advanceFrom(panel);
  }

  retry() {
    const action = this.#retryAction;
    this.#retryAction = null;
    for (const panel of this.#questions) this.#toggleError(panel, false);
    if (this.refs.resultsError) this.refs.resultsError.hidden = true;
    action?.();
  }

  skipEmail() {
    if (this.#busy) return;
    this.#showResults();
  }

  retake() {
    clearTimeout(this.#autoTimer);
    this.#resultsRun++;
    this.#lookaheadRun++;
    this.#busy = false;
    this.setAttribute("aria-busy", "false");
    if (this.refs.resultsLoading) this.refs.resultsLoading.hidden = true;
    if (this.refs.resultsError) this.refs.resultsError.hidden = true;
    if (this.refs.resultsEmpty) this.refs.resultsEmpty.hidden = true;
    this.#answers.clear();
    this.#unavailable.clear();
    this.#emailSubmitted = false;
    this.#retryAction = null;
    this.#clearStorage();

    for (const panel of this.#questions) {
      for (const input of this.#inputs(panel)) input.checked = false;
      for (const card of panel.querySelectorAll("[data-quiz-option][data-quiz-filtered]")) {
        /** @type {HTMLElement} */ (card).hidden = false;
        card.removeAttribute("data-quiz-filtered");
      }
      panel.querySelector("[data-quiz-auto-list]")?.replaceChildren();
      this.#toggleError(panel, false);
    }
    // Theme editor: the cascade of the run just reset may have re-marked cards and notices; go
    // back to the full-collection preview (one cached request per render).
    if (this.#designMode) this.#editorPreview();

    const { emailInput, emailError } = this.refs;
    if (emailInput) {
      emailInput.value = "";
      emailInput.removeAttribute("aria-invalid");
    }
    if (emailError) emailError.hidden = true;

    this.refs.resultsList?.replaceChildren();
    this.#resetResultsCopy();

    if (this.refs.intro) {
      this.#showScreen(this.refs.intro, { focus: true });
      this.#announce(this.#headingText(this.refs.intro));
    } else {
      this.#begin({ focus: true });
    }
  }

  /** @param {Event} event */
  onOptionChange(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const panel = this.#panelOf(input);
    if (!panel || !input.checked) return;

    const id = this.#id(panel);
    const previous = this.#answers.get(id)?.[0]?.value;
    if (previous !== input.value) this.#clearAfter(panel);

    this.#answers.set(id, [this.#answerFrom(input)]);
    if (panel === this.#current) this.#updateQuestionUi(panel);
    if (previous !== input.value) this.#lookahead(panel);
  }

  /** @param {MouseEvent} event */
  onOptionClick(event) {
    if (!this.#autoAdvance || this.#arrowNavigation) return;
    const panel = this.#panelOf(/** @type {HTMLElement} */ (event.target));
    if (panel) this.#scheduleAdvance(panel);
  }

  /** @param {KeyboardEvent} event */
  onOptionKeydown(event) {
    if (ARROW_KEYS.has(event.key)) {
      // Native radio-group movement selects (and in some engines dispatches a click); it must
      // never advance. The flag outlives that synchronous default action, then clears.
      this.#arrowNavigation = true;
      setTimeout(() => {
        this.#arrowNavigation = false;
      }, 0);
      return;
    }

    const input = /** @type {HTMLInputElement} */ (event.target);

    if (event.key === " ") {
      // Space on an UNCHECKED card checks it and dispatches a click (`onOptionClick` advances).
      // On an already-checked one the browser fires neither, so advance here, like Enter.
      if (!this.#autoAdvance || !input.checked) return;
      event.preventDefault();
      const panel = this.#panelOf(input);
      if (panel) this.#scheduleAdvance(panel);
      return;
    }

    if (event.key !== "Enter") return;

    event.preventDefault();
    if (!input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const panel = this.#panelOf(input);
    if (!panel) return;
    if (this.#autoAdvance) {
      this.#scheduleAdvance(panel);
    }
  }

  // ── Answers ─────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} element
   * @returns {HTMLElement | null}
   */
  #panelOf(element) {
    return this.#questions.find((panel) => panel.contains(element)) ?? null;
  }

  /**
   * @param {HTMLElement} panel
   * @returns {HTMLInputElement[]}
   */
  #inputs(panel) {
    return /** @type {HTMLInputElement[]} */ (Array.from(panel.querySelectorAll('input[type="radio"]')));
  }

  /**
   * @param {HTMLInputElement} input
   * @returns {Answer}
   */
  #answerFrom(input) {
    const { dataset } = input;
    return {
      value: input.value,
      label: dataset.label ?? "",
      filterValue: dataset.resolvedValue || dataset.filterValue || "",
      strong: splitList(dataset.strong),
      partial: splitList(dataset.partial),
      exclude: splitList(dataset.exclude),
      skip: splitList(dataset.skipQuestions).map(handleize).filter(Boolean),
      noPreference: dataset.noPreference === "true",
    };
  }

  /**
   * A changed answer invalidates everything after it: later answers, the options the filter
   * produced for later questions, and which of them the filter emptied.
   * @param {HTMLElement} panel
   */
  #clearAfter(panel) {
    const questions = this.#questions;
    for (const later of questions.slice(questions.indexOf(panel) + 1)) {
      const id = this.#id(later);
      this.#answers.delete(id);
      this.#unavailable.delete(id);
      for (const input of this.#inputs(later)) input.checked = false;
      later.querySelector("[data-quiz-auto-list]")?.replaceChildren();
    }
  }

  /** @param {HTMLElement} panel */
  #scheduleAdvance(panel) {
    clearTimeout(this.#autoTimer);
    const flow = this.#flow();
    // The last question always waits for its results button.
    if (flow.indexOf(panel) >= flow.length - 1) return;
    this.#autoTimer = setTimeout(() => {
      if (this.#current === panel && this.#hasAnswer(panel)) this.#advanceFrom(panel, true, true);
    }, AUTO_ADVANCE_DELAY);
  }

  /**
   * Store-filter mode: once `panel` is answered, prepare the questions after it in the background
   * so the ones the filter empties drop out of the flow BEFORE the shopper presses Next — when all
   * of them do, `panel` is the last question and shows the results button. Same URLs as the Next
   * click, so that click reuses these requests. Silent: a failure is left to the Next click, which
   * shows the inline retry.
   * @param {HTMLElement} panel
   */
  async #lookahead(panel) {
    if (this.#mode !== "filter" || !this.#hasAnswer(panel)) return;
    const run = ++this.#lookaheadRun;
    try {
      for (;;) {
        const flow = this.#flow();
        const next = flow[flow.indexOf(panel) + 1];
        if (!next || !this.#needsPreparing(next)) break;
        const outcome = await this.#prepare(next);
        if (run !== this.#lookaheadRun || this.#abortController.signal.aborted) return;
        if (outcome !== "empty") break;
        this.#unavailable.add(this.#id(next));
      }
    } catch {
      return;
    }
    if (panel === this.#current && !this.#busy) this.#updateQuestionUi(panel);
  }

  // ── Screens ─────────────────────────────────────────────────────────────────

  /**
   * Exactly one screen visible; the others are `hidden` (out of the tab order).
   * @param {HTMLElement} screen
   * @param {{ focus: boolean, animate?: boolean }} options - `animate` defaults to `focus`: only a
   *   shopper-driven change animates, never the first paint (a fade would hide it from LCP).
   */
  #showScreen(screen, { focus, animate = focus }) {
    const entering = animate && this.dataset.animations === "true" && !prefersReducedMotion();

    for (const candidate of this.#screens) {
      const active = candidate === screen;
      candidate.hidden = !active;
      candidate.toggleAttribute("data-entering", active && entering);
    }

    const isQuestion = this.#questions.includes(screen);
    if (this.refs.progress) this.refs.progress.hidden = !isQuestion;
    if (!isQuestion) this.#current = null;

    if (focus) this.#focus(screen);
  }

  /**
   * @param {HTMLElement} panel
   * @param {{ focus: boolean }} options
   */
  #showQuestion(panel, { focus }) {
    this.#showScreen(panel, { focus: false, animate: focus });
    this.#current = panel;
    this.#renderQuestionCopy(panel);
    this.#updateQuestionUi(panel);

    if (focus) {
      this.#announce(this.#progressText(panel));
      this.#focus(panel);
    }
  }

  /**
   * Heading / subtext of `panel` with `[question_id]` tokens resolved from the current answers.
   * Runs on every show (forward, Back, Retake, editor block select), so a changed earlier answer
   * is reflected, and before the heading takes focus, so it is read with the rendered text. Both
   * the heading and the subtext are inline richtext (`data-quiz-rich`): trusted merchant HTML from
   * the settings, so the template is used as-is; an element without `data-quiz-rich` would get its
   * template escaped first. Either way `applyTokens` escapes the answers. A subtext that resolves
   * to no text is hidden.
   * @param {HTMLElement} panel
   */
  #renderQuestionCopy(panel) {
    const tokens = this.#tokenMap();
    for (const element of panel.querySelectorAll("[data-quiz-tokenized]")) {
      if (!(element instanceof HTMLElement)) continue;
      const template = element.dataset.template ?? "";
      const isRich = element.hasAttribute("data-quiz-rich");
      element.innerHTML = applyTokens(isRich ? template : escapeHtml(template), tokens);
      if (!element.matches("[data-quiz-focus]")) element.hidden = !element.textContent?.trim();
    }
  }

  /** @param {HTMLElement} panel */
  #updateQuestionUi(panel) {
    const flow = this.#flow();
    const position = flow.indexOf(panel);
    const isLast = position === flow.length - 1;
    const answered = this.#hasAnswer(panel);

    /** @type {HTMLButtonElement | null} */
    const next = panel.querySelector("[data-quiz-next]");
    if (next) {
      next.hidden = this.#autoAdvance && !isLast;
      next.setAttribute("aria-disabled", String(!answered));
      const label = (isLast ? this.dataset.resultsLabel : this.dataset.nextLabel) ?? "";
      /** @type {HTMLElement | null} */
      const text = next.querySelector("[data-quiz-next-text]");
      if (text && label) {
        text.textContent = label;
        text.dataset.label = label;
      }
    }

    /** @type {HTMLElement | null} */
    const back = panel.querySelector("[data-quiz-back]");
    if (back) back.hidden = position <= 0;

    this.#updateProgress(panel);
  }

  /**
   * Steps of `#progressFlow()`: done / current / upcoming, or skipped (an earlier answer emptied
   * it), wherever it sits.
   * @param {HTMLElement} panel
   */
  #updateProgress(panel) {
    const flow = this.#progressFlow();
    const ids = flow.map((question) => this.#id(question));
    // A question outside the flow only shows in the theme editor (block select): fall back to its
    // document position so the preview still reads sensibly.
    const inFlow = ids.indexOf(this.#id(panel));
    const position = inFlow >= 0 ? inFlow : this.#questions.indexOf(panel);
    const total = inFlow >= 0 ? flow.length : this.#questions.length;

    for (const step of this.#steps) {
      const index = inFlow >= 0 ? ids.indexOf(step.dataset.questionId ?? "") : this.#steps.indexOf(step);
      step.hidden = index < 0;
      if (index < 0) continue;
      step.dataset.state = this.#unavailable.has(ids[index])
        ? "skipped"
        : index < position
          ? "done"
          : index === position
            ? "current"
            : "upcoming";
      if (index === position) {
        step.setAttribute("aria-current", "step");
      } else {
        step.removeAttribute("aria-current");
      }
      const number = step.querySelector("[data-quiz-step-number]");
      if (number) number.textContent = String(index + 1);
    }

    this.refs.progress?.style.setProperty("--product-quiz-steps", String(total));
    // The stepper's solid accent fill runs up to the current step (visible steps only).
    this.refs.progress?.style.setProperty("--product-quiz-progress-index", String(Math.max(position, 0)));

    const text = this.#formatProgress(position + 1, total);
    if (this.refs.progressLabel) this.refs.progressLabel.textContent = text;
    const eyebrow = panel.querySelector("[data-quiz-eyebrow]");
    if (eyebrow) eyebrow.textContent = text;
  }

  /** @param {HTMLElement} panel */
  #progressText(panel) {
    const flow = this.#progressFlow();
    return this.#formatProgress(flow.indexOf(panel) + 1, flow.length);
  }

  /**
   * @param {number} current
   * @param {number} total
   */
  #formatProgress(current, total) {
    return (this.dataset.progressTemplate ?? "")
      .replace("[current]", String(current))
      .replace("[total]", String(total));
  }

  /**
   * Polite live-region announcement of a shopper-driven screen change: "Question n of N" for a
   * question, the screen heading for the intro, email and results screens.
   * @param {string} text
   */
  #announce(text) {
    if (this.refs.live && text) this.refs.live.textContent = text;
  }

  /**
   * The intro and email copy are merchant `text` children (`[data-quiz-copy]`): the first one's
   * text, skipping an eyebrow `_content-label` pill (`[data-card-label-slot]`), else the screen's
   * localized `data-quiz-label`. Other screens: their focus heading.
   * @param {HTMLElement} screen
   * @returns {string}
   */
  #headingText(screen) {
    const copy = screen.querySelector("[data-quiz-copy]");
    const source = copy
      ? Array.from(copy.children).find((child) => !child.querySelector("[data-card-label-slot]"))
      : screen.querySelector("[data-quiz-focus]");
    const text = (source?.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || (screen.dataset.quizLabel ?? "");
  }

  /**
   * Focus the screen's `[data-quiz-focus]` target: the intro and email screens are that target
   * themselves (their heading is a merchant `text` child), questions and results their heading.
   * Then land the screen at the top (`#scrollToTop`).
   * @param {HTMLElement} screen
   */
  #focus(screen) {
    /** @type {HTMLElement | null} */
    const target = screen.matches("[data-quiz-focus]") ? screen : screen.querySelector("[data-quiz-focus]");
    target?.focus({ preventScroll: true });
    this.#scrollToTop(screen);
  }

  /**
   * Every shopper-driven screen change lands at the same spot, whichever way that scrolls: the top
   * of the progress on a question (the screen itself otherwise) just under a sticky header, plus
   * the anchor's own `scroll-margin-top`. Screens differ in height, so "only when scrolled past"
   * left a short question mid-screen or its progress under the header. Already there: no scroll.
   * @param {HTMLElement} screen
   */
  #scrollToTop(screen) {
    const { progress } = this.refs;
    const anchor = progress && !progress.hidden ? progress : screen;
    const stickyHeader = document.querySelector('header[is="sticky-header"]');
    const headerHeight = stickyHeader
      ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0
      : 0;
    const gap = parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0;
    const offset = anchor.getBoundingClientRect().top - headerHeight - gap;
    if (Math.abs(offset) < 4) return;
    window.scrollTo({
      top: Math.max(0, window.scrollY + offset),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  // ── Busy / error ────────────────────────────────────────────────────────────

  /**
   * Run an async step with the loading state on `busyHost` (spinner on its Next / Start button,
   * controls inert through the `#busy` guard). Resolves "error" and shows the inline retry of
   * `panel` on failure.
   * @template T
   * @param {HTMLElement} panel - The question that shows the inline error.
   * @param {() => Promise<T>} task
   * @param {() => void} retry - What the inline "Try again" button re-runs.
   * @param {HTMLElement} [busyHost] - The screen whose button spins (defaults to `panel`).
   * @returns {Promise<T | "error">}
   */
  async #run(panel, task, retry, busyHost = panel) {
    this.#setBusy(busyHost, true);
    try {
      return await task();
    } catch {
      if (this.#abortController.signal.aborted) return "error";
      this.#retryAction = retry;
      this.#toggleError(panel, true);
      return "error";
    } finally {
      this.#setBusy(busyHost, false);
    }
  }

  /**
   * @param {HTMLElement} host - A question panel (its Next button) or the intro (its Start button).
   * @param {boolean} busy
   */
  #setBusy(host, busy) {
    this.#busy = busy;
    this.setAttribute("aria-busy", String(busy));
    /** @type {HTMLElement | null} */
    const marker = host.querySelector("[data-quiz-next], [data-quiz-start]");
    const isStart = Boolean(marker?.hasAttribute("data-quiz-start"));
    const button = marker && isStart ? this.#startButton(marker) : marker;
    if (!button) return;
    button.classList.toggle("btn--loading", busy);
    if (busy) {
      button.setAttribute("aria-disabled", "true");
    } else if (host === this.#current) {
      this.#updateQuestionUi(host);
    } else if (isStart) {
      button.removeAttribute("aria-disabled");
    }
  }

  /**
   * The Start button inside the intro's `[data-quiz-start]` wrapper: the `<button type="button">`
   * of the `_product-quiz-start-button` block. Reached by tag, never by class.
   * @param {HTMLElement} wrapper
   * @returns {HTMLElement | null}
   */
  #startButton(wrapper) {
    return wrapper.querySelector("button, a");
  }

  /**
   * @param {HTMLElement} panel
   * @param {boolean} show
   */
  #toggleError(panel, show) {
    /** @type {HTMLElement | null} */
    const error = panel.querySelector("[data-quiz-error]");
    if (error) error.hidden = !show;
  }

  // ── Store-filter mode ───────────────────────────────────────────────────────

  /**
   * One parsed Section Rendering response per URL. A failed request is dropped from `#cache`, so
   * a retry fetches again (the core `sectionRenderer` drops a rejected in-flight request too).
   * @param {URL} url
   * @returns {Promise<Document>}
   */
  #fetch(url) {
    url.searchParams.sort();
    const key = url.toString();
    let pending = this.#cache.get(key);
    if (!pending) {
      pending = sectionRenderer
        .getSectionHTML(ENDPOINT_ID, false, url)
        .then((html) => new DOMParser().parseFromString(html, "text/html"));
      this.#cache.set(key, pending);
      pending.catch(() => this.#cache.delete(key));
    }
    return pending;
  }

  /**
   * The collection URL every Finder request starts from (pre-fetch, cascade, look-ahead, results,
   * bare index fetch), with `filter.v.availability=1` unless the URL already carries it.
   * @returns {URL}
   */
  #collectionUrl() {
    const url = new URL(this.dataset.collectionUrl || "/collections/all", window.location.origin);
    if (!url.searchParams.has(AVAILABILITY_PARAM)) url.searchParams.set(AVAILABILITY_PARAM, "1");
    return url;
  }

  /**
   * Read a collection response (filtered or not): learn every filter's param name and value
   * spellings, so answers can be turned into `filter.*` params. Runs on every collection response,
   * so the index costs no request of its own.
   * @param {Document} doc
   */
  #learn(doc) {
    const { params, values } = this.#filterIndex;
    for (const filter of doc.querySelectorAll("[data-quiz-filter]")) {
      const param = filter.getAttribute("data-param-name") ?? "";
      if (!param) continue;
      params.set(param.toLowerCase(), param);
      params.set((filter.getAttribute("data-label") ?? "").trim().toLowerCase(), param);
      const map = values.get(param) ?? new Map();
      for (const value of filter.querySelectorAll("[data-value]")) {
        const raw = value.getAttribute("data-value") ?? "";
        map.set(raw.toLowerCase(), raw);
        map.set((value.getAttribute("data-label") ?? "").trim().toLowerCase(), raw);
      }
      values.set(param, map);
    }
    this.#indexed = true;
  }

  /**
   * True when an answer before `target` (every answer when `target` is null) must become a
   * `filter.*` param.
   * @param {HTMLElement | null} target
   */
  #hasFilterAnswers(target) {
    for (const panel of this.#flow()) {
      if (panel === target) break;
      const answers = this.#answers.get(this.#id(panel)) ?? [];
      if (answers.some((answer) => !answer.noPreference && answer.filterValue)) return true;
    }
    return false;
  }

  /**
   * The index is normally learned from the first question's pre-fetch. Only when nothing has been
   * read yet AND an answer needs a param name (a results run restored after the email post, or a
   * pre-fetch that failed and was answered anyway) is the bare collection fetched first.
   * @param {HTMLElement | null} target
   */
  async #ensureIndexed(target) {
    if (this.#indexed || !this.#hasFilterAnswers(target)) return;
    this.#learn(await this.#fetch(this.#collectionUrl()));
  }

  /**
   * @param {HTMLElement} panel
   * @returns {string | null}
   */
  #paramFor(panel) {
    if (panel.dataset.paramName) return panel.dataset.paramName;
    const key = (panel.dataset.filter ?? "").trim();
    if (!key) return null;
    return this.#filterIndex.params.get(key.toLowerCase()) ?? (key.startsWith("filter.") ? key : null);
  }

  /**
   * The collection URL with the `filter.*` params of every answered question BEFORE `target`
   * (every answered question when `target` is null), on top of `#collectionUrl()`'s
   * `filter.v.availability=1`: options whose only stock is sold out drop out of the cascade (the
   * first-question pre-fetch included), and the results list in-stock products only.
   * @param {HTMLElement | null} target
   * @returns {URL}
   */
  #filterUrl(target) {
    const url = this.#collectionUrl();
    for (const panel of this.#flow()) {
      if (panel === target) break;
      const param = this.#paramFor(panel);
      if (!param) continue;
      for (const answer of this.#answers.get(this.#id(panel)) ?? []) {
        if (answer.noPreference || !answer.filterValue) continue;
        const known = this.#filterIndex.values.get(param)?.get(answer.filterValue.toLowerCase());
        url.searchParams.append(param, known ?? answer.filterValue);
      }
    }
    return url;
  }

  /**
   * Fetch the narrowed filters for `target` and update its cards: ONE request (the filter index is
   * learned from this same response).
   * @param {HTMLElement} target
   * @returns {Promise<"ready" | "empty">}
   */
  async #prepare(target) {
    await this.#ensureIndexed(target);
    const url = this.#filterUrl(target);
    const doc = await this.#fetch(url);
    this.#learn(doc);
    const outcome = this.#applyOptions(target, doc);
    // No answer narrowed this response (the URL `#fetch` sorted is the bare collection URL): what
    // is empty here is empty for every shopper.
    const base = this.#collectionUrl();
    base.searchParams.sort();
    const forAll = base.toString() === url.toString();
    if (forAll && outcome === "empty") this.#emptyForAll.add(this.#id(target));
    // Only while the answers before `target` are still the ones this response was narrowed by.
    const current = this.#filterUrl(target);
    current.searchParams.sort();
    if (current.toString() === url.toString()) this.#dropEmptyLater(target, doc, forAll);
    return outcome;
  }

  /**
   * A response narrowed by the answers before `target` lists, for every LATER question as well, a
   * superset of the values that question can ever offer (a later answer only narrows further). So
   * a later question already empty here (its filter missing, or no card left) is unavailable for
   * good: it leaves the flow now. Found by the first question's pre-fetch (no answer yet), it is
   * empty for everyone and leaves the progress total too, so the first question already reads
   * "of N" correctly; found after an answer, it stays in the total as a skipped step.
   * The theme editor keeps every question, as `#applyOptions` does.
   * @param {HTMLElement} target
   * @param {Document} doc
   * @param {boolean} forAll - No answer narrowed `doc`: an empty question is empty for everyone.
   */
  #dropEmptyLater(target, doc, forAll) {
    if (this.#designMode) return;
    const questions = this.#questions;
    for (const later of questions.slice(questions.indexOf(target) + 1)) {
      if (!this.#needsPreparing(later) || !this.#isEmptyIn(later, doc)) continue;
      this.#unavailable.add(this.#id(later));
      if (forAll) this.#emptyForAll.add(this.#id(later));
    }
  }

  /**
   * `#applyOptions`'s "empty" verdict for `panel` against `doc`, without touching its cards.
   * @param {HTMLElement} panel
   * @param {Document} doc
   * @returns {boolean}
   */
  #isEmptyIn(panel, doc) {
    const source = this.#matchFilter(doc, (panel.dataset.filter ?? "").trim());
    if (!source) return true;
    const values = Array.from(source.querySelectorAll("[data-value]"), (value) => ({
      value: (value.getAttribute("data-value") ?? "").toLowerCase(),
      label: (value.getAttribute("data-label") ?? "").toLowerCase(),
    }));
    if (panel.dataset.optionSource === "auto") return !values.length;
    return !this.#inputs(panel).some((input) => {
      if (input.dataset.noPreference === "true") return false;
      const wanted = (input.dataset.filterValue ?? "").trim().toLowerCase();
      return !wanted || values.some((value) => value.value === wanted || value.label === wanted);
    });
  }

  /**
   * @param {Document} doc
   * @param {string} key - The question's `filter` setting: a param name or a filter label.
   * @returns {Element | null}
   */
  #matchFilter(doc, key) {
    const byName = doc.querySelector(`[data-quiz-filter][data-param-name="${CSS.escape(key)}"]`);
    if (byName) return byName;
    const lower = key.toLowerCase();
    for (const filter of doc.querySelectorAll("[data-quiz-filter]")) {
      if ((filter.getAttribute("data-label") ?? "").trim().toLowerCase() === lower) return filter;
    }
    return null;
  }

  /**
   * Hide manual cards whose value matched no product, or rebuild generated cards. A question left
   * with no card, or with only "No preference" cards, is empty and gets skipped. In the theme
   * editor nothing is hidden or skipped — the cards carry a "Hidden" badge and the question an
   * editor notice instead (`#markEditorHidden` / `#renderEditorNotice`), recomputed on every call.
   * @param {HTMLElement} panel
   * @param {Document} doc
   * @returns {"ready" | "empty"}
   */
  #applyOptions(panel, doc) {
    const key = (panel.dataset.filter ?? "").trim();
    const source = key ? this.#matchFilter(doc, key) : null;
    const designMode = this.#designMode;

    if (source) panel.dataset.paramName = source.getAttribute("data-param-name") ?? "";

    if (key && !source) {
      if (designMode) {
        // The whole question is skipped on the storefront: no card is hidden on its own.
        for (const input of this.#inputs(panel)) this.#markEditorHidden(input, false);
        this.#renderEditorNotice(panel, { missing: true });
      }
      return designMode ? "ready" : "empty";
    }

    const values = source
      ? Array.from(source.querySelectorAll("[data-value]"), (value) => ({
          value: value.getAttribute("data-value") ?? "",
          label: value.getAttribute("data-label") ?? "",
        }))
      : [];

    if (panel.dataset.optionSource === "auto") {
      this.#buildAutoOptions(panel, values);
      if (designMode) this.#renderEditorNotice(panel, {});
      return values.length || designMode ? "ready" : "empty";
    }

    const id = this.#id(panel);
    /** @type {string[]} */
    const hiddenLabels = [];
    let visible = 0;
    for (const input of this.#inputs(panel)) {
      /** @type {HTMLElement | null} */
      const card = input.closest("[data-quiz-option]");
      const wanted = (input.dataset.filterValue ?? "").trim();
      let show = true;

      if (source && wanted && input.dataset.noPreference !== "true") {
        const lower = wanted.toLowerCase();
        const match = values.find(
          (value) => value.value === wanted || value.value.toLowerCase() === lower || value.label.toLowerCase() === lower
        );
        show = Boolean(match);
        if (match) input.dataset.resolvedValue = match.value;
      }

      if (card) {
        card.toggleAttribute("data-quiz-filtered", !show);
        card.hidden = !show && !designMode;
      }
      if (designMode) {
        this.#markEditorHidden(input, !show);
        if (!show) hiddenLabels.push(input.dataset.label ?? "");
      }
      if (!show && input.checked) {
        input.checked = false;
        // Picked before the cascade hid it (e.g. during the first-question pre-fetch): drop it.
        if (this.#answers.get(id)?.[0]?.value === input.value) this.#answers.delete(id);
      }
      // "No preference" alone is not a choice: it does not keep the question in the flow.
      if (show && input.dataset.noPreference !== "true") visible++;
    }

    if (designMode) this.#renderEditorNotice(panel, { hidden: hiddenLabels });
    return visible || designMode ? "ready" : "empty";
  }

  /**
   * Theme editor only: flag the card of `input` as hidden on the storefront. The card keeps its
   * layout and stays selectable; CSS dims it and the `[data-quiz-editor-badge]` pill shows.
   * @param {HTMLInputElement} input
   * @param {boolean} hidden
   */
  #markEditorHidden(input, hidden) {
    const card = input.closest("[data-quiz-option]");
    if (!card) return;
    card.toggleAttribute("data-quiz-editor-hidden", hidden);
    /** @type {HTMLElement | null} */
    const badge = card.querySelector("[data-quiz-editor-badge]");
    if (badge) badge.hidden = !hidden;
  }

  /**
   * Theme editor only: the question's `[data-quiz-editor-notice]` lists every editor warning, from
   * the locale templates the server rendered into its `data-text-*` attributes (`data-variant`
   * "warning"). With no warning, a generated-options question shows its `data-text-generated` note
   * instead (`data-variant` "info"); a warning always wins and drops the note. The icon matching
   * the variant shows (`[data-quiz-notice-icon]`). Hidden when there is nothing to say, so a fixed
   * condition clears it on the next recompute.
   * @param {HTMLElement} panel
   * @param {{ missing?: boolean, hidden?: string[] }} state - `missing`: the filter was not found
   *   (or the collection is too large to have filters); `hidden`: labels of the hidden manual cards.
   */
  #renderEditorNotice(panel, { missing = false, hidden = [] }) {
    /** @type {HTMLElement | null} */
    const notice = panel.querySelector("[data-quiz-editor-notice]");
    const text = notice?.querySelector("[data-quiz-editor-notice-text]");
    if (!notice || !text) return;

    /** @type {string[]} */
    const messages = [];
    if (missing) {
      const filter = panel.dataset.filter ?? "";
      messages.push(
        this.hasAttribute("data-editor-large-collection")
          ? notice.dataset.textLarge ?? ""
          : (notice.dataset.textFilter ?? "").replace("[filter]", () => filter)
      );
    }
    if (hidden.length) {
      const names = hidden.filter(Boolean).join(", ");
      messages.push(
        (notice.dataset.textHidden ?? "")
          .replace("[count]", String(hidden.length))
          .replace("[names]", () => names)
      );
    }

    const warnings = messages.filter(Boolean);
    const info = warnings.length ? "" : notice.dataset.textGenerated ?? "";
    const variant = warnings.length ? "warning" : "info";
    notice.dataset.variant = variant;
    for (const icon of notice.querySelectorAll("[data-quiz-notice-icon]")) {
      /** @type {HTMLElement} */ (icon).hidden = icon.getAttribute("data-quiz-notice-icon") !== variant;
    }

    text.replaceChildren(
      ...(info ? [info] : warnings).map((message) => {
        const line = document.createElement("p");
        line.textContent = message;
        return line;
      })
    );
    notice.hidden = !text.childElementCount;
  }

  /**
   * Text cards, in the order the endpoint returns the values (the Search & Discovery order).
   * @param {HTMLElement} panel
   * @param {{ value: string, label: string }[]} values
   */
  #buildAutoOptions(panel, values) {
    /** @type {HTMLElement | null} */
    const list = panel.querySelector("[data-quiz-auto-list]");
    /** @type {HTMLTemplateElement | null} */
    const template = panel.querySelector("template[data-quiz-auto-template]");
    const prototype = template?.content.firstElementChild;
    if (!list || !prototype) return;

    const previous = this.#answers.get(this.#id(panel))?.[0]?.filterValue;
    const cards = values.map((value) => {
      const card = /** @type {HTMLElement} */ (prototype.cloneNode(true));
      /** @type {HTMLInputElement | null} */
      const input = card.querySelector('input[type="radio"]');
      if (input) {
        input.name = panel.dataset.radioName ?? input.name;
        input.value = `auto:${value.value}`;
        input.dataset.label = value.label;
        input.dataset.filterValue = value.value;
        input.dataset.resolvedValue = value.value;
        input.checked = previous === value.value;
      }
      const title = card.querySelector("[data-quiz-option-title]");
      if (title) title.textContent = value.label;
      return card;
    });

    list.replaceChildren(...cards);
  }

  // ── Results ─────────────────────────────────────────────────────────────────

  #showResults() {
    const { results } = this.refs;
    if (!results) return;
    this.#showScreen(results, { focus: true });
    this.#renderResultsCopy(false);
    this.#announce(this.#headingText(results));
    this.#loadResults();
  }

  async #loadResults() {
    const { resultsList, resultsLoading, resultsEmpty, resultsError } = this.refs;
    if (!resultsList) return;

    resultsList.replaceChildren();
    if (resultsEmpty) resultsEmpty.hidden = true;
    if (resultsError) resultsError.hidden = true;
    if (resultsLoading) resultsLoading.hidden = false;
    this.#busy = true;
    this.setAttribute("aria-busy", "true");
    const run = ++this.#resultsRun;

    try {
      let rows = await this.#matchingRows();
      let fallback = false;

      if (!rows.length) {
        fallback = true;
        rows = await this.#rowsForIds(splitList(this.refs.results?.dataset.fallbackIds));
      }
      if (this.#abortController.signal.aborted || run !== this.#resultsRun) return;

      this.#renderResultsCopy(fallback, !rows.length);
      // The heading switched to the fallback copy: say so too.
      if (fallback && this.refs.results) this.#announce(this.#headingText(this.refs.results));
      this.#renderRows(rows.slice(0, this.#limit));
      if (resultsEmpty) resultsEmpty.hidden = rows.length > 0;
    } catch {
      if (this.#abortController.signal.aborted || run !== this.#resultsRun) return;
      this.#retryAction = () => this.#loadResults();
      if (resultsError) resultsError.hidden = false;
    } finally {
      if (run === this.#resultsRun) {
        if (resultsLoading) resultsLoading.hidden = true;
        this.#busy = false;
        this.setAttribute("aria-busy", "false");
      }
    }
  }

  /** @returns {Promise<Element[]>} */
  async #matchingRows() {
    if (this.#mode === "filter") {
      await this.#ensureIndexed(null);
      const doc = await this.#fetch(this.#filterUrl(null));
      this.#learn(doc);
      return this.#rowsFrom(doc);
    }
    return this.#rowsForIds(this.#productIds());
  }

  /**
   * Product-list mode: every strong id in question order, then every partial id, minus every
   * excluded id, de-duplicated. No-preference answers contribute nothing.
   * @returns {string[]}
   */
  #productIds() {
    /** @type {string[]} */
    const strong = [];
    /** @type {string[]} */
    const partial = [];
    /** @type {Set<string>} */
    const exclude = new Set();

    for (const panel of this.#flow()) {
      for (const answer of this.#answers.get(this.#id(panel)) ?? []) {
        if (answer.noPreference) continue;
        strong.push(...answer.strong);
        partial.push(...answer.partial);
        for (const id of answer.exclude) exclude.add(id);
      }
    }

    return [...new Set([...strong, ...partial])].filter((id) => !exclude.has(id));
  }

  /**
   * Fetch rows for `ids` through the search endpoint, in `ids` order. Requests go in chunks of
   * 12 (the endpoint's row cap) until enough AVAILABLE products are found — sold-out and deleted
   * products simply do not come back.
   * @param {string[]} ids
   * @returns {Promise<Element[]>}
   */
  async #rowsForIds(ids) {
    /** @type {Element[]} */
    const rows = [];
    for (let request = 0; request < MAX_ID_REQUESTS && rows.length < this.#limit; request++) {
      const chunk = ids.slice(request * IDS_PER_REQUEST, (request + 1) * IDS_PER_REQUEST);
      if (!chunk.length) break;
      const doc = await this.#fetch(this.#searchUrl(chunk));
      rows.push(...this.#rowsFrom(doc, chunk));
    }
    return rows;
  }

  /**
   * @param {string[]} ids
   * @returns {URL}
   */
  #searchUrl(ids) {
    const url = new URL(this.dataset.searchUrl || "/search", window.location.origin);
    url.searchParams.set("type", "product");
    url.searchParams.set("q", ids.map((id) => `id:${id}`).join(" OR "));
    return url;
  }

  /**
   * @param {Document} doc
   * @param {string[]} [order] - Re-order to these ids (search order is relevance, not ours).
   * @returns {Element[]}
   */
  #rowsFrom(doc, order) {
    const rows = Array.from(doc.querySelectorAll("[data-quiz-products] > [data-quiz-product-id]"));
    if (!order) return rows;
    const byId = new Map(rows.map((row) => [row.getAttribute("data-quiz-product-id") ?? "", row]));
    return /** @type {Element[]} */ (order.map((id) => byId.get(id)).filter(Boolean));
  }

  /** @param {Element[]} rows */
  #renderRows(rows) {
    const { resultsList, rowTemplate } = this.refs;
    const prototype = rowTemplate?.content.firstElementChild;
    if (!resultsList || !prototype) return;

    // importNode, not the parsed node itself: the parsed document is cached for the next run.
    const scheme = resultsList.dataset.rowScheme;
    const items = rows.map((row) => {
      const item = /** @type {HTMLElement} */ (prototype.cloneNode(true));
      const clone = /** @type {Element} */ (document.importNode(row, true));
      if (scheme) this.#paintRow(clone, scheme);
      item.append(clone);
      return item;
    });
    resultsList.replaceChildren(...items);
  }

  /**
   * The endpoint cannot read the results block, so its box cards carry the theme's global box
   * scheme. Swap that `color-*` class on the card root for the results block's row scheme.
   * @param {Element} row
   * @param {string} scheme - Colour scheme id from the list's `data-row-scheme`.
   */
  #paintRow(row, scheme) {
    const card = row.querySelector("product-card");
    if (!card) return;
    for (const name of Array.from(card.classList)) {
      if (name.startsWith("color-")) card.classList.remove(name);
    }
    card.classList.add(`color-${scheme}`);
  }

  /**
   * Heading / description (main or fallback copy) with `[question_id]` tokens resolved, plus the
   * answer summary and — after a successful email step — the discount message.
   * @param {boolean} fallback
   * @param {boolean} [empty] - The fallback list is empty too: the description ("Here are our most
   *   popular picks") and the answer summary would frame products that are not there, so only the
   *   heading, the "No products found" message and Retake remain.
   */
  #renderResultsCopy(fallback, empty = false) {
    const { resultsHeading, resultsDescription, resultsSummary, resultsDiscount, results } = this.refs;
    const tokens = this.#tokenMap();
    const attribute = fallback ? "data-fallback-template" : "data-template";

    for (const element of [resultsHeading, resultsDescription]) {
      if (!element) continue;
      const template = element.getAttribute(attribute) ?? element.getAttribute("data-template") ?? "";
      element.innerHTML = applyTokens(template, tokens);
    }
    if (resultsDescription) resultsDescription.hidden = empty;

    if (resultsSummary) {
      const labels = [];
      for (const panel of this.#flow()) {
        if (panel.dataset.showInSummary !== "true") continue;
        const label = this.#answerText(panel);
        if (label) labels.push(label);
      }
      resultsSummary.textContent = labels.join(" · ");
      resultsSummary.hidden = empty || results?.dataset.showSummary !== "true" || !labels.length;
    }

    if (resultsDiscount) {
      const template = this.refs.discountTemplate;
      const show = this.#emailSubmitted && Boolean(template);
      resultsDiscount.replaceChildren(...(show && template ? [template.content.cloneNode(true)] : []));
      resultsDiscount.hidden = !show;
    }
  }

  /**
   * Retake: the hidden results screen goes back to its server state, the main heading and
   * description templates as written (tokens unresolved; the fallback copy, if it was showing, is
   * switched back), with no summary or discount. `#renderResultsCopy` resolves the tokens again
   * when the next results load, so no token-stripped text from the empty answer set lingers.
   */
  #resetResultsCopy() {
    const { resultsHeading, resultsDescription, resultsSummary, resultsDiscount } = this.refs;
    for (const element of [resultsHeading, resultsDescription]) {
      if (element) element.innerHTML = element.getAttribute("data-template") ?? "";
    }
    if (resultsDescription) resultsDescription.hidden = false;
    if (resultsSummary) {
      resultsSummary.textContent = "";
      resultsSummary.hidden = true;
    }
    if (resultsDiscount) {
      resultsDiscount.replaceChildren();
      resultsDiscount.hidden = true;
    }
  }

  /** @returns {Map<string, string>} */
  #tokenMap() {
    /** @type {Map<string, string>} */
    const map = new Map();
    for (const panel of this.#flow()) {
      const label = this.#answerText(panel);
      if (label) map.set(this.#id(panel), label);
    }
    return map;
  }

  /**
   * The shopper-facing answer of `panel` for the summary line and `[question_id]` tokens. A "No
   * preference" answer says nothing about the product, so it yields '' (its token is removed).
   * @param {HTMLElement} panel
   * @returns {string}
   */
  #answerText(panel) {
    return (this.#answers.get(this.#id(panel)) ?? [])
      .filter((answer) => !answer.noPreference && answer.label)
      .map((answer) => answer.label)
      .join(", ");
  }

  // ── Email ───────────────────────────────────────────────────────────────────

  /**
   * The customer form is posted NATIVELY. Shopify binds hCaptcha to every `customer` form: it adds
   * a submit listener and replaces `form.submit` with a wrapper that solves the challenge, then
   * posts. A `fetch()` skips all of that and is answered 403 at `/contact`, so the quiz instead
   * saves its answers to sessionStorage, lets the platform post the form, and `#restore()` opens
   * the results when the page comes back.
   *
   * This listener runs in the capture phase, i.e. before hCaptcha's own one. It always takes the
   * user's submit over (validation must stop hCaptcha too), then re-submits through ONE path:
   *   - `form.submit` replaced (hCaptcha's wrapper present) → call it; it does not fire `submit`,
   *     so nothing runs twice;
   *   - otherwise → `requestSubmit()`, flagged so this listener lets it through untouched: any
   *     platform submit listener sees a real submit event, and without one the browser posts.
   * @param {SubmitEvent} event
   */
  #onEmailSubmit = (event) => {
    if (this.#nativeSubmit) {
      this.#nativeSubmit = false;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const form = /** @type {HTMLFormElement} */ (event.currentTarget);
    const { emailInput, emailTags, emailReturnTo, email } = this.refs;
    if (!emailInput) return;

    const address = emailInput.value.trim();
    if (!EMAIL_PATTERN.test(address)) {
      this.#emailError(email?.dataset.errorInvalid ?? "");
      emailInput.focus();
      return;
    }
    this.#emailError(null);
    emailInput.value = address;
    if (emailTags) emailTags.value = this.#tags().join(",");
    if (emailReturnTo) {
      emailReturnTo.value = this.#returnUrl(form);
      emailReturnTo.disabled = false;
    }
    this.#saveState();

    try {
      if (form.submit !== HTMLFormElement.prototype.submit) {
        form.submit();
      } else {
        this.#nativeSubmit = true;
        form.requestSubmit(this.refs.emailSubmit ?? undefined);
      }
      this.#setEmailBusy(true);
    } catch {
      // The post never left (no navigation follows): keep the shopper here with a message.
      this.#nativeSubmit = false;
      this.#clearStorage();
      this.#emailError(email?.dataset.errorGeneric ?? "");
    }
  };

  /**
   * Where the post comes back to: this page, marked with this quiz's section id and aimed at its
   * form, minus the markers of an earlier post.
   * @param {HTMLFormElement} form
   * @returns {string}
   */
  #returnUrl(form) {
    const url = new URL(window.location.href);
    for (const param of ["customer_posted", "form_type", RETURN_PARAM]) url.searchParams.delete(param);
    url.searchParams.set(RETURN_PARAM, this.dataset.sectionId ?? "");
    url.hash = form.id;
    return `${url.pathname}${url.search}${url.hash}`;
  }

  /** @param {string | null} message */
  #emailError(message) {
    const { emailInput, emailError } = this.refs;
    if (emailError) {
      emailError.textContent = message ?? "";
      emailError.hidden = !message;
    }
    if (message) {
      emailInput?.setAttribute("aria-invalid", "true");
    } else {
      emailInput?.removeAttribute("aria-invalid");
    }
  }

  /** @param {boolean} busy */
  #setEmailBusy(busy) {
    // Visual only: the page navigates away. Not `disabled` and no `#busy` guard, so a shopper who
    // dismisses the hCaptcha challenge can simply press Continue again.
    const { emailSubmit } = this.refs;
    if (!emailSubmit) return;
    emailSubmit.classList.toggle("btn--loading", busy);
    emailSubmit.toggleAttribute("aria-busy", busy);
  }

  /**
   * The window regains focus: most often the shopper dismissed the hCaptcha challenge (its iframe
   * held focus). Clear the Continue spinner, and — only when the post was in flight and focus
   * landed nowhere (`<body>` / null, after the challenge's own focus handling has run) — put the
   * shopper back in the email field. Someone who moved focus elsewhere is not pulled back.
   */
  #onWindowFocus = () => {
    const { emailSubmit, emailInput, email } = this.refs;
    const wasBusy = Boolean(emailSubmit?.classList.contains("btn--loading"));
    this.#setEmailBusy(false);
    if (!wasBusy || !emailInput || !email || email.hidden) return;
    setTimeout(() => {
      if (this.#abortController.signal.aborted || email.hidden) return;
      const active = document.activeElement;
      if (!active || active === document.body) emailInput.focus();
    }, 0);
  };

  /**
   * `newsletter`, the prefix, and `{prefix}-{question_id}-{answer}` per answer.
   * @returns {string[]}
   */
  #tags() {
    const prefix = handleize(this.refs.email?.dataset.tagPrefix ?? "");
    const tags = ["newsletter"];
    if (prefix) tags.push(prefix);
    for (const panel of this.#flow()) {
      for (const answer of this.#answers.get(this.#id(panel)) ?? []) {
        const handle = handleize(answer.label);
        if (handle) tags.push([prefix, this.#id(panel), handle].filter(Boolean).join("-"));
      }
    }
    return [...new Set(tags)];
  }

  // ── Session state (native customer-form post) ───────────────────────────────

  #saveState() {
    try {
      const state = { answers: Array.from(this.#answers.entries()), unavailable: Array.from(this.#unavailable) };
      window.sessionStorage.setItem(this.#storageKey, JSON.stringify(state));
    } catch {
      // Storage unavailable (private mode quota): the native submit still records the customer.
    }
  }

  #clearStorage() {
    try {
      window.sessionStorage.removeItem(this.#storageKey);
    } catch {
      // Ignore: nothing was stored.
    }
  }

  /**
   * Back from the native customer-form post: restore the answers and open the results. Scoped to
   * THIS quiz — its own sessionStorage key, plus a return marker: our `return_to` param (when
   * Shopify honours `return_to`) or Shopify's own `customer_posted` / `form_type=customer` (when it
   * does not). A hash naming ANOTHER form on the page (Shopify appends the posted form's id) means
   * that form was posted, not ours.
   *
   * `form_type=customer` without `customer_posted` is Shopify's error return — for a pre-validated
   * address that is "already subscribed", which counts as done (same as before: results +
   * discount). The quiz renders no server-side form errors of its own.
   * @returns {boolean} True when the results screen was restored.
   */
  #restore() {
    let raw = null;
    try {
      raw = window.sessionStorage.getItem(this.#storageKey);
    } catch {
      return false;
    }
    if (!raw) return false;
    this.#clearStorage();

    const params = new URLSearchParams(window.location.search);
    const sectionId = this.dataset.sectionId ?? "";
    const formId = this.#form?.id ?? "";
    const marked =
      params.get(RETURN_PARAM) === sectionId ||
      params.get("customer_posted") === "true" ||
      params.get("form_type") === "customer";
    const hash = window.location.hash.slice(1);
    const hashTarget = hash && hash !== formId ? document.getElementById(hash) : null;
    if (!marked || hashTarget instanceof HTMLFormElement) return false;

    try {
      const state = JSON.parse(raw);
      this.#answers = new Map(state.answers ?? []);
      this.#unavailable = new Set(state.unavailable ?? []);
    } catch {
      return false;
    }

    for (const panel of this.#questions) {
      const values = new Set((this.#answers.get(this.#id(panel)) ?? []).map((answer) => answer.value));
      for (const input of this.#inputs(panel)) input.checked = values.has(input.value);
    }

    this.#cleanReturnUrl();
    this.#emailSubmitted = true;
    this.#showResults();
    this.#dismissNewsletterDialog();
    return true;
  }

  /** Drop the post markers, so a reload does not look like a fresh post. */
  #cleanReturnUrl() {
    const url = new URL(window.location.href);
    for (const param of ["customer_posted", "form_type", RETURN_PARAM]) url.searchParams.delete(param);
    if (url.hash.slice(1) === this.#form?.id) url.hash = "";
    window.history.replaceState(window.history.state, "", url);
  }

  /**
   * Core's `newsletter-form.js` opens its message dialog for ANY customer post (a server-rendered
   * `form.posted_successfully?` alert, or `form_type=customer` in the URL), and that modal would
   * leave the restored quiz inert. After OUR post, close it — only a `<newsletter-form>`'s message
   * dialog, and only one carrying the server-rendered post alert (success, or the error Shopify
   * returns for an already-subscribed address); through its public `closeDialog()`, now if already
   * open, else on its `dialog:open` (which does not bubble, so it is listened for on each
   * candidate). Focus then goes back to the results heading (closeDialog restores it elsewhere).
   */
  #dismissNewsletterDialog() {
    const { signal } = this.#abortController;
    for (const host of document.querySelectorAll("newsletter-form dialog-component")) {
      if (!host.querySelector('[ref="alert"]')) continue;
      const close = async () => {
        const component = /** @type {any} */ (host);
        if (typeof component.closeDialog === "function") {
          await component.closeDialog();
        } else {
          host.querySelector("dialog")?.close();
        }
        const { results } = this.refs;
        if (results && !results.hidden && !signal.aborted) this.#focus(results);
      };
      if (host.querySelector("dialog[open]")) {
        close();
      } else {
        host.addEventListener(DialogOpenEvent.eventName, close, { once: true, signal });
      }
    }
  }

  // ── Theme editor ────────────────────────────────────────────────────────────

  /** @param {Event} event */
  #onBlockSelect = (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const { intro, email, results } = this.refs;

    if (intro?.contains(target)) {
      this.#showScreen(intro, { focus: false });
    } else if (email?.contains(target)) {
      this.#showScreen(email, { focus: false });
    } else if (results?.contains(target)) {
      // No fetch: the editor pre-renders preview rows into the list.
      this.#showScreen(results, { focus: false });
    } else {
      const panel = this.#panelOf(/** @type {HTMLElement} */ (target));
      if (!panel) return;
      this.#showQuestion(panel, { focus: false });
      // Its cards come from the base response (already fetched on connect, or fetched now).
      this.#editorPreview(panel);
    }
  };

  /**
   * Theme editor, Finder quiz: the storefront only fills a filter-driven question when the flow
   * reaches it (Start / intro-off load for the first one, the answer cascade for the rest), so a
   * question selected in the editor — after every re-render, which starts from a fresh element —
   * would show no generated cards. Instead ONE bare collection request per render (the same URL as
   * the first-question pre-fetch, availability param included, so that pre-fetch shares it through
   * `#cache`) fills every generated question with the full value list (no cascade) and runs the
   * editor-only question notice and "Hidden" card badges (via `#applyOptions`). The storefront
   * never calls this.
   * @param {HTMLElement} [only] - Block select: fill just this question, and only when nothing
   *   (preview or cascade) has filled it yet — e.g. emptied by a changed earlier answer or Retake.
   */
  async #editorPreview(only) {
    if (!this.#designMode || this.#mode !== "filter") return;

    if (!this.#editorBase) {
      this.#editorBase = this.#fetch(this.#collectionUrl()).then((doc) => {
        this.#learn(doc);
        return doc;
      });
    }

    let doc;
    try {
      doc = await this.#editorBase;
    } catch {
      // Silent in the editor: the next block select retries.
      this.#editorBase = null;
      return;
    }
    if (this.#abortController.signal.aborted) return;

    for (const panel of only ? [only] : this.#questions) {
      if (!this.#needsPreparing(panel)) continue;
      if (only) {
        const list = panel.querySelector("[data-quiz-auto-list]");
        if (panel.dataset.optionSource !== "auto" || !list || list.childElementCount) continue;
      } else if (this.#hasFilterAnswers(panel)) {
        // Already narrowed by the shopper flow (the dev clicked through): leave the cascade's cards.
        continue;
      }
      this.#applyOptions(panel, doc);
    }
  }
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Mirror of Liquid's `handleize` for ASCII input (question ids, tags, tokens).
 * @param {string} value
 */
function handleize(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** @param {string} value */
function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

/**
 * Replace `[question_id]` with the answer. An unknown, skipped or "No preference" token is removed
 * together with ONE adjacent space (the one before it, else the one after it). Two removed tokens
 * in a row can still leave a space before punctuation ("…Civic ." — the first removal already took
 * the space the second one needed), so once anything was removed the result is tidied: no space
 * before `.,!?;:`, no double space, no leading/trailing space.
 * @param {string} template
 * @param {Map<string, string>} tokens
 */
function applyTokens(template, tokens) {
  let removed = false;
  const result = template.replace(/(\s?)\[([\w-]+)\](\s?)/g, (_match, before, token, after) => {
    const label = tokens.get(handleize(token));
    if (label) return `${before}${escapeHtml(label)}${after}`;
    removed = true;
    return before ? after : "";
  });
  if (!removed) return result;
  return result
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

if (!customElements.get("product-quiz")) {
  customElements.define("product-quiz", ProductQuiz);
}
