/**
 * @capability Customized built-in elements polyfill (@ungap/custom-elements) — makes `is="..."` upgrades (e.g. <div is="swipe-component">) and customElements.define(name, Class, { extends: tag }) work in Safari, which never implemented customized built-ins natively.
 * @when Never imported by feature code — loaded once globally as a plain deferred script by snippets/scripts.liquid. Relevant whenever you author a customized built-in (a class extending HTMLDivElement etc. registered with { extends }): this file is why that pattern is safe cross-browser.
 * @contract Side-effect script with no exports; keep the custom-elements.js script tag in scripts.liquid ahead of theme modules. Source of the vite-built src/js/modules/custom-elements.js — edit HERE, never the build output.
 * @keywords custom elements polyfill, customized built-in, is attribute, extends, Safari, customElements.define, webreflection, builtin-elements
 */
import "@ungap/custom-elements";
