/**
 * @capability Vendored PhotoSwipe 5 bundle — full-screen image lightbox with pinch/scroll zoom, pan, swipe-between-images, keyboard navigation and open/close zoom transitions; exports PhotoSwipe and PhotoSwipeLightbox.
 * @when Image zoom / fullscreen gallery viewing (product media gallery zoom uses it). Do not hand-roll a zoom modal or import another lightbox — wire PhotoSwipeLightbox from this bundle instead.
 * @contract JS library only, no custom element; consumer instantiates PhotoSwipeLightbox with a gallery/children selector or a dataSource of {src, width, height} items and calls init(). Respects prefers-reduced-motion. Source of the vite-built src/js/modules/photoswipe.js — edit HERE, never the build output.
 * @keywords lightbox, image zoom, fullscreen gallery, photoswipe, pinch zoom, product zoom, media viewer, image modal, swipe gallery, zoom in
 */
import PhotoSwipeLightbox from "photoswipe/lightbox";
import PhotoSwipe from "photoswipe";

export { PhotoSwipeLightbox, PhotoSwipe };
