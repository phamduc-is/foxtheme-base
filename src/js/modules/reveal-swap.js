import { morph } from "@theme/morph";

/**
 * @capability Swaps a server-rendered placeholder for fetched markup without the layout jump: morphs the host (children survive — a carousel re-initialises through updatedCallback with its inline styles intact, no flat frame), then holds the host at the placeholder height, measures the real one two frames later, and transitions between them while the new content fades in.
 * @when Any host that renders a skeleton (product-card-placeholder) and fetches its real list later — product recommendations (section, block, cart drawer), recently viewed products, the predictive-search recommendations panel. Call this instead of innerHTML + a hand-rolled height transition.
 * @contract revealSwap(host, newTree, { duration = 250 }) → returns a `finish()` that cancels a pending reveal and clears the inline height (call it from disconnectedCallback and before the next swap). The host gets `.is-revealing` for the length of the transition; pair with the `.is-revealing` rule in src/scss/global/_component-product-recommendations.scss (transition: height; [data-has-recommendations] fades in). Skipped (plain morph) under prefers-reduced-motion, inside a <dialog>, or when the host had no height yet.
 * @keywords skeleton swap, placeholder reveal, fetched list height transition, morph fetched markup, async product list, layout shift, CLS
 */

/**
 * @param {HTMLElement} host - the element the fetched markup replaces (morphed in place)
 * @param {Element} newTree - the fetched counterpart of `host`
 * @param {{ duration?: number }} [options] - `duration`: the CSS `transition: height` length, ms
 * @returns {() => void} finish — cancel a pending reveal and drop the inline height
 */
export function revealSwap(host, newTree, { duration = 250 } = {}) {
  /** @type {{ raf: number, timer: ReturnType<typeof setTimeout> | null } | null} */
  let pending = null;

  const onEnd = (/** @type {TransitionEvent} */ event) => {
    if (event.target === host && event.propertyName === "height") finish();
  };

  const finish = () => {
    if (!pending) return;
    cancelAnimationFrame(pending.raf);
    if (pending.timer) clearTimeout(pending.timer);
    host.removeEventListener("transitionend", onEnd);
    pending = null;
    host.style.height = "";
    host.classList.remove("is-revealing");
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Inside a dialog (the cart drawer's recommendations) the list sits at the bottom with
  // nothing below it to push, the drawer is often still sliding in, and every cart change
  // refetches it — a height transition there is a second motion on top of the drawer's and a
  // shimmy on each add/remove. Swap at once; the morph still keeps the carousel alive.
  const inDialog = host.closest("dialog") !== null;
  const oldHeight = host.getBoundingClientRect().height;

  if (reduceMotion || inDialog || oldHeight === 0) {
    morph(host, newTree);
    return finish;
  }

  host.style.height = `${oldHeight}px`;
  host.classList.add("is-revealing");
  morph(host, newTree);

  // Two frames: a carousel destroys + recreates Swiper inside the rAF that its
  // `updatedCallback` schedules, so the first frame still measures the old layout.
  const raf = requestAnimationFrame(() => {
    const inner = requestAnimationFrame(() => {
      if (!pending) return;

      // Unlock only to measure — nothing paints between these three writes.
      host.style.height = "";
      const newHeight = host.getBoundingClientRect().height;
      host.style.height = `${oldHeight}px`;

      if (Math.abs(newHeight - oldHeight) < 1) {
        finish();
        return;
      }

      void host.offsetHeight; // commit the locked height before the transition starts
      host.style.height = `${newHeight}px`;
      host.addEventListener("transitionend", onEnd, { once: true });
      // `transitionend` does not fire when the tab is hidden or the transition is
      // interrupted — never leave the host pinned to a stale height.
      pending.timer = setTimeout(finish, duration * 2);
    });
    if (pending) pending.raf = inner;
  });

  pending = { raf, timer: null };
  return finish;
}
