/**
 * @capability Vendored Lenis (lenis.darkroom.engineering) smooth-scroll library — exports Lenis, consumed via the @theme/lenis import alias and never imported directly by a component.
 * @when Only `getLenis()` in utilities constructs it, and only when the merchant setting, the device and prefers-reduced-motion all allow it. Everything else asks `getLenis()` and degrades to window.scrollY when it returns null.
 * @contract JS library only, no custom element. Exports: Lenis. Source of the vite-built src/js/modules/lenis.js — edit HERE, never the build output. Loaded by dynamic import so a store with smooth scroll off never downloads it.
 * @keywords lenis, smooth scroll, scroll smoothing, wheel, inertia, scroll hijacking, momentum
 */
import Lenis from "lenis";
export { Lenis };
