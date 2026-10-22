/**
 * @capability Vendored Swiper library bundle — exports the raw Swiper class plus the Navigation, Pagination, Mousewheel, Autoplay, EffectFade and A11y modules, consumed via the @theme/swiper import alias.
 * @when NEVER use directly from a section or new module — build on <carousel-slider> (CarouselComponent in carousel.js), which owns configuration, lifecycle, morph survival and accessibility on top of this library. Import from @theme/swiper only when extending the carousel infrastructure itself.
 * @contract JS library only, no custom element; standard Swiper DOM (.swiper > .swiper-wrapper > .swiper-slide) is created/managed by CarouselComponent. Exports: Swiper, Navigation, Pagination, Mousewheel, Autoplay, EffectFade, A11y. Source of the vite-built src/js/modules/swiper.js — edit HERE, never the build output.
 * @keywords swiper library, slider engine, carousel engine, vendored dependency, swiper modules, autoplay module, effect fade, third-party bundle
 */
import Swiper from "swiper";
import { Navigation, Pagination, Mousewheel, Autoplay, EffectFade, A11y } from "swiper/modules";

// import "swiper/css";
// import "swiper/css/effect-fade";

// Export all modules
export { Swiper, Navigation, Pagination, Mousewheel, Autoplay, EffectFade, A11y };
