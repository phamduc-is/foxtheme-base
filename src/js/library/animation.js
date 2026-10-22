/**
 * @capability Vendored Motion (motion.dev) animation library — exports animate, stagger, inView and scroll, consumed via the @theme/animation import alias.
 * @when Programmatic tween/spring animations, scroll-linked effects and in-view triggers. Prefer the declarative layer first — <motion-component> (data-motion presets) and coordinatedInView via @theme/motion-coordinator, which budget concurrent animations; import @theme/animation directly only for bespoke animation logic those cannot express.
 * @contract JS library only, no custom element. Exports: animate, stagger, inView, scroll. Source of the vite-built src/js/modules/animation.js — edit HERE, never the build output.
 * @keywords animation, motion, tween, spring, scroll-linked, in view, stagger, animate, motion.dev
 */
// Motion library - direct API exports with minimal compatibility helpers
// Based on Motion (https://motion.dev) library

import { animate, stagger, inView, scroll } from "motion";
export { animate, stagger, inView, scroll };
