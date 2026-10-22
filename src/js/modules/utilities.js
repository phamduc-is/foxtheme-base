/**
 * @capability Grab-bag of shared helpers every module leans on: breakpoint media queries (mediaQueryMobile/Tablet/Desktop, is*Breakpoint, prefersReducedMotion), timing (debounce, throttle, requestIdleCallback, scheduler), fetchConfig for Shopify AJAX requests, money formatting (formatShopifyMoney, formatCurrency), storage (get/setLocalStorage, CookieManager), focus management (trapFocus, getFocusableElements, cycleFocus), DOM waiting (onDocumentReady, onAnimationEnd, waitForMediaReady, waitForEvent), viewport/geometry checks (getVisibleElements, coordinatedInView, isClickedOutside), device detection (isTouch, isSafari, getIOSVersion, isRTL), getSectionId, viewTransition, Tooltip and Lenis accessors, ResizeNotifier.
 * @when Before hand-rolling ANY generic helper — a debounce, a breakpoint check, a fetch header builder, a focus trap, a money formatter — it almost certainly already exists here; import it instead.
 * @contract Named exports from @theme/utilities — e.g. import { debounce, isMobileBreakpoint, fetchConfig, trapFocus } from "@theme/utilities".
 * @keywords utilities, helpers, debounce, throttle, breakpoint, media query, mobile, fetchConfig, format money, currency, localStorage, cookie, trap focus, focusable, reduced motion, section id, tooltip, lenis, resize observer, view transition, idle callback
 */

// Detect browser has support local storage.
let isStorageSupported = false;
try {
  const key = "motrix:test";
  window.localStorage.setItem(key, "test");
  window.localStorage.removeItem(key);
  isStorageSupported = true;
} catch (err) {}

export function hasLocalStorage() {
  return isStorageSupported;
}

/**
 * Store key-value pair with expiration time in localStorage
 * Use storage instead of cookie to make it work properly on Safari IOS (in iframe).
 *
 * @param {string} key
 * @param {*} value
 * @param {*} expiryInDays
 * @returns
 */
export function setLocalStorage(key, value, expiryInDays = null) {
  if (!hasLocalStorage()) return;

  const item = {
    value: value,
  };

  if (expiryInDays !== null) {
    const now = new Date();
    item.expiry = now.getTime() + expiryInDays * 86400000;
  }

  window.localStorage.setItem(key, JSON.stringify(item));
}

export function getLocalStorage(key) {
  if (!hasLocalStorage()) return null;

  const itemStr = window.localStorage.getItem(key);
  // If the item doesn't exist, return null.
  if (!itemStr) {
    return null;
  }
  const item = JSON.parse(itemStr);
  // Compare the expiry time of the item with the current time.
  if (item.expiry && new Date().getTime() > item.expiry) {
    // If the item has expired, remove it from storage and return null.
    window.localStorage.removeItem(key);
    return null;
  }
  return item.value;
}

export function removeLocalStorage(key) {
  if (!hasLocalStorage()) return;
  window.localStorage.removeItem(key);
}

/**
 * Handoff slot for an add-to-cart error that has to survive a navigation:
 * a product card's quick-add fails, and with `cart_type: page` the message is
 * shown under the matching line once the cart page has loaded.
 */
const CART_LINE_ERROR_KEY = "motrixtheme:cart-line-error";

/**
 * Stores an add-to-cart error for the cart page to pick up after navigation.
 * @param {object} error - The error to hand off.
 * @param {string} error.variantId - The variant the error belongs to.
 * @param {string} error.message - The message to show under that line.
 */
export function setPendingCartLineError({ variantId, message }) {
  try {
    window.sessionStorage.setItem(CART_LINE_ERROR_KEY, JSON.stringify({ variantId, message, at: Date.now() }));
  } catch (err) {}
}

/**
 * Reads and clears a handed-off add-to-cart error. Consumed once: a stale entry
 * (an old tab restored, a back navigation) must not resurface as a fresh error.
 * @param {number} [maxAge] - How old the entry may be, in milliseconds.
 * @returns {{ variantId: string, message: string } | null} The error, or null when there is none.
 */
export function takePendingCartLineError(maxAge = 15000) {
  try {
    const stored = window.sessionStorage.getItem(CART_LINE_ERROR_KEY);
    if (!stored) return null;

    window.sessionStorage.removeItem(CART_LINE_ERROR_KEY);

    const { variantId, message, at } = JSON.parse(stored);
    if (!variantId || !message || Date.now() - at > maxAge) return null;

    return { variantId, message };
  } catch (err) {
    return null;
  }
}

export class CookieManager {
  static PRODUCT_RECENTLY_VIEWED = "motrixtheme:recently-viewed";
  static SUBSCRIBE_POPUP = "motrixtheme:popup";
  static COMPARE_PRODUCTS = "motrixtheme:compare-products";
  static COMPARE_IS_ACTIVE = "motrixtheme:compare-is-active";
  static COMPARE_BAR_COLLAPSED = "motrixtheme:compare-bar-collapsed";
}

/**
 * Request an idle callback or fallback to setTimeout
 * @returns {function} The requestIdleCallback function
 */
export const requestIdleCallback =
  typeof window.requestIdleCallback == "function" ? window.requestIdleCallback : setTimeout;

/**
 * Executes a callback in a separate task after the next frame.
 * Using to defer non-critical tasks until after the interaction is complete.
 * @see https://web.dev/articles/optimize-inp#yield_to_allow_rendering_work_to_occur_sooner
 * @param {() => any} callback - The callback to execute
 */
export const requestYieldCallback = (callback) => {
  requestAnimationFrame(() => {
    setTimeout(callback, 0);
  });
};

/**
 * Check if the browser supports View Transitions API
 * @returns {boolean} True if the browser supports View Transitions API, false otherwise
 */
export function supportsViewTransitions() {
  return typeof document.startViewTransition === "function";
}

/**
 * The current view transition
 * @type {{ current: Promise<void> | undefined }}
 */
export const viewTransition = {
  current: undefined,
};

/**
 * @typedef {Object} FetchConfig
 * @property {string} method
 * @property {Headers} headers
 * @property {string | FormData | undefined} [body]
 */

/**
 * Creates a fetch configuration object
 * @param {string} [type] The type of response to expect
 * @param {Object} [config] The config of the request
 * @param {FetchConfig['body']} [config.body] The body of the request
 * @param {FetchConfig['headers']} [config.headers] The headers of the request
 * @returns {RequestInit} The fetch configuration object
 */
export function fetchConfig(type = "json", config = {}) {
  /** @type {Headers} */
  const headers = {
    "Content-Type": "application/json",
    Accept: `application/${type}`,
    ...config.headers,
  };

  if (type === "javascript") {
    headers["X-Requested-With"] = "XMLHttpRequest";
    delete headers["Content-Type"];
  }

  return {
    method: "POST",
    headers: /** @type {HeadersInit} */ (headers),
    body: config.body,
  };
}

/**
 * Extract section Id from element
 * @param {Element} element
 * @returns
 */
export function getSectionId(element) {
  if (element.hasAttribute("data-section-id")) {
    return element.dataset.sectionId;
  } else {
    if (!element.classList.contains("shopify-section")) {
      element = element.closest(".shopify-section");
    }
    return element.id.replace("shopify-section-", "");
  }
}

/**
 * Creates a debounced function that delays calling the provided function (fn)
 * until after wait milliseconds have elapsed since the last time
 * the debounced function was invoked. The returned function has a .cancel()
 * method to cancel any pending calls.
 *
 * @template {(...args: any[]) => any} T
 * @param {T} fn The function to debounce
 * @param {number} wait The time (in milliseconds) to wait before calling fn
 * @returns {T & { cancel(): void }} A debounced version of fn with a .cancel() method
 */
export function debounce(fn, wait) {
  /** @type {number | undefined} */
  let timeout;

  /** @param {...any} args */
  function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  }

  // Add the .cancel method:
  debounced.cancel = () => {
    clearTimeout(timeout);
  };

  return /** @type {T & { cancel(): void }} */ (debounced);
}

/**
 * Creates a throttled function that calls the provided function (fn) at most once per every wait milliseconds
 *
 * @template {(...args: any[]) => any} T
 * @param {T} fn The function to throttle
 * @param {number} delay The time (in milliseconds) to wait before calling fn
 * @returns {T & { cancel(): void }} A throttled version of fn with a .cancel() method
 */
export function throttle(fn, delay) {
  let lastCall = 0;

  /** @param {...any} args */
  function throttled(...args) {
    const now = performance.now();
    // If the time since the last call exceeds the delay, execute the callback
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  }

  throttled.cancel = () => {
    lastCall = performance.now();
  };

  return /** @type {T & { cancel(): void }} */ (throttled);
}

/**
 * A media query for reduced motion
 * @type {MediaQueryList}
 */
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Check if the user prefers reduced motion
 * @returns {boolean} True if the user prefers reduced motion, false otherwise
 */
export function prefersReducedMotion() {
  return reducedMotion.matches;
}

/**
 * A media query for hover fined
 * @type {MediaQueryList}
 */
const hoverFine = matchMedia("(hover: hover)");

/**
 * Check if the user prefers reduced motion
 * @returns {boolean} True if the user prefers reduced motion, false otherwise
 */
export function mediaHoverFine() {
  return hoverFine.matches;
}

/**
 * Normalize a string
 * @param {string} str The string to normalize
 * @returns {string} The normalized string
 */
export function normalizeString(str) {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Format a money value
 * @param {string} value The value to format
 * @returns {string} The formatted value
 */
export function formatMoney(value) {
  let valueWithNoSpaces = value.replace(" ", "");
  if (valueWithNoSpaces.indexOf(",") === -1) return valueWithNoSpaces;
  if (valueWithNoSpaces.indexOf(",") < valueWithNoSpaces.indexOf(".")) return valueWithNoSpaces.replace(",", "");
  if (valueWithNoSpaces.indexOf(".") < valueWithNoSpaces.indexOf(","))
    return valueWithNoSpaces.replace(".", "").replace(",", ".");
  if (valueWithNoSpaces.indexOf(",") !== -1) return valueWithNoSpaces.replace(",", ".");

  return valueWithNoSpaces;
}

/**
 * Format currency amount for display using Shopify's money format
 * @param {number|string} cents - Amount in cents
 * @param {string} format - Money format string (optional)
 * @returns {string} Formatted currency string
 */
export function formatCurrency(cents, format) {
  // Use Shopify's money formatting if available
  if (window.Shopify?.formatMoney) {
    return window.Shopify.formatMoney(cents, format);
  }

  // Fallback to our own implementation with current currency
  return formatShopifyMoney(cents, format);
}

/**
 * The money format the theme's Liquid is currently rendering with.
 *
 * `snippets/price.liquid` swaps `money` for `money_with_currency` when the merchant
 * turns on "show currency code", so an optimistic JS price must swap with it or it
 * flashes "$25.00" until the fetched HTML settles on "$25.00 USD".
 *
 * @param {boolean} [withCurrencyCode] - Force the choice. Defaults to the merchant's
 *   setting; pass false where the Liquid counterpart hardcodes `| money` (the
 *   fixed-amount sale badge).
 * @returns {string} The Shopify money format string.
 */
export function getMoneyFormat(withCurrencyCode) {
  const foxTheme = window.FoxTheme ?? {};
  const useCurrencyCode = withCurrencyCode ?? foxTheme.showCurrencyCode === true;

  if (useCurrencyCode && foxTheme.moneyWithCurrencyFormat) return foxTheme.moneyWithCurrencyFormat;

  return foxTheme.moneyFormat || window.Shopify?.currency?.money_format || "${{amount}}";
}

/**
 * Shopify-compatible money formatting function
 * @param {number|string} cents - Amount in cents
 * @param {string} format - Money format string (optional)
 * @returns {string} Formatted currency string
 */
export function formatShopifyMoney(cents, format) {
  // Get current currency format from theme's FoxTheme object or use default
  let moneyFormat = "${{amount}}"; // eslint-disable-line camelcase

  if (window.FoxTheme?.moneyFormat) {
    moneyFormat = window.FoxTheme.moneyFormat;
  } else if (window.Shopify?.currency?.money_format) {
    moneyFormat = window.Shopify.currency.money_format;
  }

  if (typeof cents === "string") {
    cents = cents.replace(".", "");
  }

  let value = "";
  const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  const formatString = format || moneyFormat;

  function formatWithDelimiters(number, precision, thousands, decimal) {
    thousands = thousands || ",";
    decimal = decimal || ".";

    if (isNaN(number) || number === null) {
      return 0;
    }

    number = (number / 100.0).toFixed(precision);

    const parts = number.split(".");
    const dollarsAmount = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + thousands);
    const centsAmount = parts[1] ? decimal + parts[1] : "";

    return dollarsAmount + centsAmount;
  }

  const match = formatString.match(placeholderRegex);
  if (!match) {
    return formatString;
  }

  switch (match[1]) {
    case "amount":
      value = formatWithDelimiters(cents, 2);
      break;
    case "amount_no_decimals":
      value = formatWithDelimiters(cents, 0);
      break;
    case "amount_with_comma_separator":
      value = formatWithDelimiters(cents, 2, ".", ",");
      break;
    case "amount_no_decimals_with_comma_separator":
      value = formatWithDelimiters(cents, 0, ".", ",");
      break;
    case "amount_no_decimals_with_space_separator":
      value = formatWithDelimiters(cents, 0, " ");
      break;
    case "amount_with_apostrophe_separator":
      value = formatWithDelimiters(cents, 2, "'");
      break;
    default:
      value = formatWithDelimiters(cents, 2);
  }

  return formatString.replace(placeholderRegex, value);
}

/**
 * Check if the document is ready and call the callback when it is.
 * @param {() => void} callback The function to call when the document is ready.
 */
export function onDocumentReady(callback) {
  if (document.readyState === "complete") {
    callback();
  } else {
    window.addEventListener("load", callback);
  }
}

/**
 * Wait for all animations to finish before calling the callback.
 * @param {Element | Element[]} elements The element(s) whose animations to wait for.
 * @param {() => void} [callback] The function to call when all animations are finished.
 * @param {Object} [options] The options to pass to `Element.getAnimations`.
 * @returns {Promise<void>} A promise that resolves when all animations are finished.
 */
export function onAnimationEnd(elements, callback, options = { subtree: true }) {
  const animations = Array.isArray(elements)
    ? elements.flatMap((element) => element.getAnimations(options))
    : elements.getAnimations(options);

  const animationPromises = animations.reduce((acc, animation) => {
    // Ignore ViewTimeline animations
    if (animation.timeline instanceof DocumentTimeline) {
      acc.push(animation.finished);
    }

    return acc;
  }, /** @type {Promise<Animation>[]} */ ([]));

  return Promise.allSettled(animationPromises).then(callback);
}

/**
 * Wait for media (img/iframe/svg) elements to be ready before proceeding.
 * Optimized for ResponsiveImage with event-based approach.
 * @param {Element[] | NodeListOf<Element> | Element | undefined} elements
 * @returns {Promise<void>}
 */
export async function waitForMediaReady(elements) {
  const list = Array.isArray(elements)
    ? elements
    : elements
      ? Array.from(/** @type {NodeListOf<Element>} */ (elements))
      : [];

  const tasks = list.map((el) => {
    if (el instanceof HTMLImageElement) {
      // Optimized path for ResponsiveImage
      const isResponsiveImage = el.getAttribute("is") === "responsive-image";

      if (isResponsiveImage) {
        // Use ready promise if available (best performance)
        if (el.ready instanceof Promise) {
          return el.ready;
        }

        // Check isReady getter
        if (typeof el.isReady === "boolean" && el.isReady) {
          return Promise.resolve();
        }

        // Fallback: listen for image:ready event
        if (!el.complete || el.naturalWidth === 0) {
          return new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000); // 5s max
            el.addEventListener(
              "image:ready",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true }
            );
          });
        }
      }

      // Standard image handling
      if (el.complete && el.naturalWidth > 0) return Promise.resolve();
      return new Promise((res) => {
        el.addEventListener("load", res, { once: true });
        el.addEventListener("error", res, { once: true });
      });
    }
    // Best-effort for iframe/svg or other media-like elements
    return Promise.resolve();
  });

  await Promise.allSettled(tasks);
}

/**
 * Wait for event fired for specify element.
 * @param {Element} element
 * @param {*} eventName
 * @returns {Promise<void>}
 */
export function waitForEvent(element, eventName) {
  return new Promise((resolve) => {
    // Event handler that checks if the event target is the expected element
    const eventHandler = (event) => {
      if (event.target === element) {
        element.removeEventListener(eventName, eventHandler); // Clean up listener
        resolve(event); // Resolve the promise with the event
      }
    };

    // Attach the event handler to the element
    element.addEventListener(eventName, eventHandler);
  });
}

/**
 * Check if the click is outside the element.
 * @param {MouseEvent} event The mouse event.
 * @param {Element} element The element to check.
 * @returns {boolean} True if the click is outside the element, false otherwise.
 */
export function isClickedOutside(event, element) {
  if (event.target instanceof HTMLDialogElement || !(event.target instanceof Element)) {
    return !isPointWithinElement(event.clientX, event.clientY, element);
  }

  return !element.contains(event.target);
}

/**
 * Check if a point is within an element.
 * @param {number} x The x coordinate of the point.
 * @param {number} y The y coordinate of the point.
 * @param {Element} element The element to check.
 * @returns {boolean} True if the point is within the element, false otherwise.
 */
export function isPointWithinElement(x, y, element) {
  const { left, right, top, bottom } = element.getBoundingClientRect();

  return x >= left && x <= right && y >= top && y <= bottom;
}

export const mediaBreakpointMobile = "(width <= 767px)";
export const mediaBreakpointSmallTablet = "(width >= 768px) and (width <= 1023px)";
export const mediaBreakpointTablet = "(width >= 768px) and (width <= 1199px)";
export const mediaBreakpointDesktop = "(width >= 1200px)";
export const mediaBreakpointLarge = "(min-width: 768px)";

/**
 * A media query for large screens
 * @type {MediaQueryList}
 */
export const mediaQueryMobile = matchMedia(mediaBreakpointMobile);
export const mediaQuerySmallTablet = matchMedia(mediaBreakpointSmallTablet);
export const mediaQueryTablet = matchMedia(mediaBreakpointTablet);
export const mediaQueryDesktop = matchMedia(mediaBreakpointDesktop);
export const mediaQueryLarge = matchMedia(mediaBreakpointLarge);

/**
 * Check if the current breakpoint is mobile
 * @returns {boolean} True if the current breakpoint is mobile, false otherwise
 */
export function isMobileBreakpoint() {
  return mediaQueryMobile.matches;
}

/**
 * Check if the current breakpoint is desktop
 * @returns {boolean} True if the current breakpoint is desktop, false otherwise
 */
export function isDesktopBreakpoint() {
  return mediaQueryDesktop.matches;
}

/**
 * Check if the current breakpoint is desktop
 * @returns {boolean} True if the current breakpoint is desktop, false otherwise
 */
export function isTabletBreakpoint() {
  return mediaQueryTablet.matches;
}

/**
 * Finds the value in an array that is closest to a target value.
 * @param {number[]} values - An array of numbers.
 * @param {number} target - The target number to find the closest value to.
 * @returns {number} The value from the array closest to the target.
 */
export function closest(values, target) {
  return values.reduce(function (prev, curr) {
    return Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev;
  });
}

/**
 * Prevents the default action of an event.
 * @param {Event} event - The event to prevent the default action of.
 */
export function preventDefault(event) {
  event.preventDefault();
}

/**
 * Get the visible elements within a root element.
 * @template {Element} T
 * @param {Element} root - The element within which elements should be visible.
 * @param {T[] | undefined} elements - The elements to check for visibility.f
 * @param {number} [ratio=1] - The minimum percentage of the element that must be visible.
 * @param {'x' | 'y'} [axis] - Whether to only check along 'x' axis, 'y' axis, or both if undefined.
 * @returns {T[]} An array containing the visible elements.
 */
export function getVisibleElements(root, elements, ratio = 1, axis) {
  if (!elements?.length) return [];
  const rootRect = root.getBoundingClientRect();

  return elements.filter((element) => {
    const { width, height, top, right, left, bottom } = element.getBoundingClientRect();

    if (ratio < 1) {
      const intersectionLeft = Math.max(rootRect.left, left);
      const intersectionRight = Math.min(rootRect.right, right);
      const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);

      if (axis === "x") {
        return width > 0 && intersectionWidth / width >= ratio;
      }

      const intersectionTop = Math.max(rootRect.top, top);
      const intersectionBottom = Math.min(rootRect.bottom, bottom);
      const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);

      if (axis === "y") {
        return height > 0 && intersectionHeight / height >= ratio;
      }

      const intersectionArea = intersectionWidth * intersectionHeight;
      const elementArea = width * height;

      // Check that at least the specified ratio of the element is visible
      return elementArea > 0 && intersectionArea / elementArea >= ratio;
    }

    const isWithinX = left >= rootRect.left && right <= rootRect.right;
    if (axis === "x") {
      return isWithinX;
    }

    const isWithinY = top >= rootRect.top && bottom <= rootRect.bottom;
    if (axis === "y") {
      return isWithinY;
    }

    return isWithinX && isWithinY;
  });
}

// Store references to our event handlers so we can remove them.
/** @type {Record<string, (event: Event) => void>} */
const trapFocusHandlers = {};

/**
 * Get all focusable elements within a container.
 * @param {HTMLElement} container - The container to get focusable elements from.
 * @returns {HTMLElement[]} An array of focusable elements.
 */
export function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      "summary, a[href], button:enabled, [tabindex]:not([tabindex^='-']), [draggable], area, input:not([type=hidden]):enabled, select:enabled, textarea:enabled, object, iframe"
    )
  );
}

/**
 * Trap focus within the given container.
 * @param {HTMLElement} container - The container to trap focus within.
 */
export function trapFocus(container) {
  // Clean up any previously set traps.
  removeTrapFocus();

  // Gather focusable elements.
  const focusable = getFocusableElements(container);
  if (!focusable.length) {
    // If nothing is focusable, just abort—no need to trap.
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Keydown handler for cycling focus with Tab and Shift+Tab
  /** @type {(event: KeyboardEvent) => void} */
  trapFocusHandlers.keydown = (event) => {
    if (event.key !== "Tab") return;

    const activeEl = document.activeElement;

    // If on the last focusable and tabbing forward, go to first
    if (!event.shiftKey && activeEl === last) {
      event.preventDefault();
      first?.focus();
    }
    // If on the first (or the container) and shift-tabbing, go to last
    else if (event.shiftKey && (activeEl === first || activeEl === container)) {
      event.preventDefault();
      last?.focus();
    }
  };

  // Focusin (capturing) handler to forcibly keep focus in the container
  /** @type {(event: FocusEvent) => void} */
  trapFocusHandlers.focusin = (event) => {
    // If the newly focused element isn't inside the container, redirect focus back.
    if (event.target instanceof Node && !container.contains(event.target)) {
      event.stopPropagation();
      // E.g., refocus the first focusable element:
      first?.focus();
    }
  };

  // Attach the handlers
  document.addEventListener("keydown", trapFocusHandlers.keydown, true);
  // Use capture phase for focusin so we can catch it before it lands outside
  document.addEventListener("focusin", trapFocusHandlers.focusin, true);

  // Finally, put focus where you want it.
  container.focus();
}

/**
 * Remove focus trap and optionally refocus another element.
 */
export function removeTrapFocus() {
  trapFocusHandlers.keydown && document.removeEventListener("keydown", trapFocusHandlers.keydown, true);
  trapFocusHandlers.focusin && document.removeEventListener("focusin", trapFocusHandlers.focusin, true);
}

export function isTouch() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
}

export function getIOSVersion() {
  const { userAgent } = navigator;
  const isIOS = /(iPhone|iPad)/i.test(userAgent);

  if (!isIOS) return null;

  const version = userAgent.match(/OS ([\d_]+)/)?.[1];
  const [major, minor] = version?.split("_") || [];
  if (!version || !major) return null;

  return {
    fullString: version.replace("_", "."),
    major: parseInt(major, 10),
    minor: minor ? parseInt(minor, 10) : 0,
  };
}

/**
 * Cycle focus to the next or previous link
 *
 * @param {HTMLElement[]} items
 * @param {number} increment
 */
export function cycleFocus(items, increment) {
  const currentIndex = items.findIndex((item) => item.matches(":focus"));
  let targetIndex = currentIndex + increment;

  if (targetIndex >= items.length) {
    targetIndex = 0;
  } else if (targetIndex < 0) {
    targetIndex = items.length - 1;
  }

  const targetItem = items[targetIndex];

  if (!targetItem) return;

  targetItem.focus();
}

class Scheduler {
  /** @type {Set<() => void>} */
  #queue = new Set();
  /** @type {boolean} */
  #scheduled = false;

  /** @param {() => void} task */
  schedule = async (task) => {
    this.#queue.add(task);

    if (!this.#scheduled) {
      this.#scheduled = true;

      // Wait for any in-progress view transitions to finish
      if (viewTransition.current) await viewTransition.current;

      requestAnimationFrame(this.flush);
    }
  };

  flush = () => {
    for (const task of this.#queue) {
      task();
    }

    this.#queue.clear();
    this.#scheduled = false;
  };
}

export const scheduler = new Scheduler();

/**
 * Tooltip Utility System
 * Provides tooltip functionality with portal rendering to avoid overflow issues
 */
class TooltipManager {
  constructor() {
    this.portal = null;
    this.activeTooltips = new Map();
    this.initialized = false;
    this.observer = null;
    this.tooltipIdCounter = 0;

    // Default options
    this.defaults = {
      position: "auto", // 'auto', 'top', 'bottom', 'left', 'right'
      trigger: "hover", // 'hover', 'click', 'focus'
      delay: 50, // Reduced from 300ms to 100ms for faster response
      hideDelay: 50,
      offset: 12,
      arrow: true,
      interactive: false,
      maxWidth: 250,
      zIndex: 9999,
      /** Opt-in bottom sheet on mobile via data-tooltip-mobile-sheet */
      mobileSheet: false,
    };

    /** Duration matching dialog slide + _component-tooltip.scss */
    this.mobileSheetCloseMs = 500;

    /** Tracks `isMobileBreakpoint()` across resizes for rebinding tooltips */
    this.lastBreakpointMobile = null;

    // Bind methods
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleResize = throttle(() => {
      this.updatePositions();
      this.#syncTooltipBindingsToViewport();
    }, 100);
    this.handleScroll = throttle(this.updatePositions.bind(this), 100);
  }

  /**
   * Initialize tooltip system
   */
  init() {
    if (this.initialized) return;

    this.createPortal();
    this.bindGlobalEvents();
    this.scanAndBind();
    this.lastBreakpointMobile = isMobileBreakpoint();
    this.initialized = true;

    // Watch for new elements added to DOM
    this.observeDOM();
  }

  /**
   * Create portal container for tooltips
   */
  createPortal() {
    if (this.portal) return;

    this.portal = document.createElement("div");
    this.portal.id = "tooltip-portal";
    this.portal.setAttribute("aria-hidden", "true");
    this.portal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: ${this.defaults.zIndex};
      pointer-events: none;
    `;

    document.body.appendChild(this.portal);
  }

  /**
   * Scan document for tooltip elements and bind events
   */
  scanAndBind(container = document) {
    const elements = container.querySelectorAll("[data-tooltip], [data-tooltip-html]");

    elements.forEach((el) => {
      if (!this.activeTooltips.has(el)) {
        this.bindElement(el);
      }
    });
  }

  /**
   * Bind tooltip events to an element
   */
  bindElement(element) {
    // Check if element is still in DOM
    if (!document.contains(element)) {
      return;
    }

    if (this.activeTooltips.has(element)) {
      return;
    }

    const options = this.getOptionsFromElement(element);

    // On small viewports only `data-tooltip-mobile-sheet="true"` tooltips are active (bottom sheet).
    if (isMobileBreakpoint() && !options.mobileSheet) {
      return;
    }

    const touchClickMode = options.trigger === "hover" && (isTouch() || isMobileBreakpoint());

    // Store element options with bound handlers for cleanup
    const handlers = {};
    this.activeTooltips.set(element, {
      options,
      tooltip: null,
      backdrop: null,
      backdropClickHandler: null,
      /** Set while closing animation runs; refs kept until DOM removal (clearTimeouts must not orphan nodes). */
      pendingRemoval: null,
      showTimeout: null,
      hideTimeout: null,
      handlers,
      touchClickMode,
    });

    // Bind events based on trigger type
    if (options.trigger === "hover") {
      if (touchClickMode) {
        handlers.click = this.handleClick.bind(this);
        element.addEventListener("click", handlers.click);
      } else {
        handlers.mouseenter = this.handleMouseEnter.bind(this);
        handlers.mouseleave = this.handleMouseLeave.bind(this);
        element.addEventListener("mouseenter", handlers.mouseenter);
        element.addEventListener("mouseleave", handlers.mouseleave);
      }
    } else if (options.trigger === "click") {
      handlers.click = this.handleClick.bind(this);
      element.addEventListener("click", handlers.click);
    } else if (options.trigger === "focus") {
      handlers.focus = this.handleFocus.bind(this);
      handlers.blur = this.handleBlur.bind(this);
      element.addEventListener("focus", handlers.focus);
      element.addEventListener("blur", handlers.blur);
    }
  }

  /**
   * Unbind tooltip events from an element
   */
  unbindElement(element) {
    const data = this.activeTooltips.get(element);
    if (!data) return;

    // Remove all event listeners (only if element is still in DOM)
    if (data.handlers && document.contains(element)) {
      try {
        Object.entries(data.handlers).forEach(([event, handler]) => {
          element.removeEventListener(event, handler);
        });
      } catch (error) {
        // Element may have been removed already
      }
    }

    // Clear timeouts
    this.clearTimeouts(element);

    // Remove tooltip if exists
    if (data.tooltip) {
      this.destroyTooltip(element);
    }

    // Remove from active tooltips
    this.activeTooltips.delete(element);
  }

  /**
   * Extra classes from data-tooltip-class / options.tooltipClass (space-separated).
   */
  #splitTooltipClassAttr(raw) {
    if (!raw || typeof raw !== "string") {
      return [];
    }

    return raw.trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Build CSS classes for tooltip
   */
  #buildTooltipClasses(options) {
    const classes = ["tooltip"];

    // Add interactive class
    if (options.interactive) {
      classes.push("tooltip--interactive");
    }

    classes.push(...this.#splitTooltipClassAttr(options.tooltipClass));

    return classes.join(" ");
  }

  /**
   * Get options from element data attributes
   */
  getOptionsFromElement(element) {
    const dataset = element.dataset;

    return {
      ...this.defaults,
      content: dataset.tooltip || dataset.tooltipHtml || "",
      isHtml: !!dataset.tooltipHtml,
      position: dataset.tooltipPosition || this.defaults.position,
      trigger: dataset.tooltipTrigger || this.defaults.trigger,
      delay: parseInt(dataset.tooltipDelay) || this.defaults.delay,
      hideDelay: parseInt(dataset.tooltipHideDelay) || this.defaults.hideDelay,
      offset: parseInt(dataset.tooltipOffset) || this.defaults.offset,
      arrow: dataset.tooltipArrow !== "false",
      interactive: dataset.tooltipInteractive === "true",
      maxWidth: parseInt(dataset.tooltipMaxWidth) || this.defaults.maxWidth,
      tooltipClass: dataset.tooltipClass || "",
      mobileSheet: dataset.tooltipMobileSheet === "true",
    };
  }

  /** Bottom sheet layout: opt-in flag + mobile breakpoint (matches dialog drawer md) */
  #shouldUseMobileSheet(options) {
    return Boolean(options.mobileSheet) && isMobileBreakpoint();
  }

  /**
   * After crossing the mobile breakpoint, re-scan so bindings match (hover vs click, sheet-only on mobile).
   */
  #syncTooltipBindingsToViewport() {
    const onMobile = isMobileBreakpoint();
    if (this.lastBreakpointMobile === onMobile) {
      return;
    }

    this.lastBreakpointMobile = onMobile;
    [...this.activeTooltips.keys()].forEach((el) => {
      this.unbindElement(el);
    });
    this.scanAndBind();
  }

  /**
   * Event handlers
   */
  handleMouseEnter(event) {
    this.show(event.currentTarget);
  }

  handleMouseLeave(event) {
    this.hide(event.currentTarget);
  }

  handleClick(event) {
    const element = event.currentTarget;
    const data = this.activeTooltips.get(element);

    if (data?.tooltip) {
      this.hide(element);
    } else {
      // Click trigger should show immediately without delay
      this.show(element, { delay: 0 });
    }
  }

  handleFocus(event) {
    // Focus should show immediately for accessibility
    this.show(event.currentTarget, { delay: 0 });
  }

  handleBlur(event) {
    this.hide(event.currentTarget);
  }

  handleKeydown(event) {
    if (event.key === "Escape") {
      this.hideAll();
    }
  }

  handleDocumentClick(event) {
    // Check if click is outside any active tooltip and its trigger
    this.activeTooltips.forEach((data, element) => {
      if (data.tooltip && (data.options.trigger === "click" || data.touchClickMode)) {
        const isClickOnTrigger = element.contains(event.target);
        const isClickOnTooltip = data.tooltip.contains(event.target);

        // Outside trigger + panel (backdrop is outside tooltip → closes sheet)
        if (!isClickOnTrigger && !isClickOnTooltip) {
          this.hide(element);
        }
      }
    });
  }

  /**
   * Show tooltip for element
   */
  show(element, options = {}) {
    const data = this.activeTooltips.get(element);
    if (!data) return;

    const mergedOptions = { ...data.options, ...options };

    if (isMobileBreakpoint() && !this.#shouldUseMobileSheet(mergedOptions)) {
      return;
    }

    // Clear any existing timeouts
    this.clearTimeouts(element);

    // Set show timeout
    data.showTimeout = setTimeout(() => {
      this.createTooltip(element, mergedOptions);
    }, mergedOptions.delay);
  }

  /**
   * Hide tooltip for element
   */
  hide(element) {
    const data = this.activeTooltips.get(element);
    if (!data) return;

    // Clear show timeout
    this.clearTimeouts(element);

    // Set hide timeout
    data.hideTimeout = setTimeout(() => {
      this.destroyTooltip(element);
    }, data.options.hideDelay);
  }

  /**
   * Hide all active tooltips
   */
  hideAll() {
    this.activeTooltips.forEach((data, element) => {
      this.destroyTooltip(element);
    });
  }

  /**
   * Clear timeouts for element
   */
  clearTimeouts(element) {
    const data = this.activeTooltips.get(element);
    if (!data) return;

    if (data.showTimeout) {
      clearTimeout(data.showTimeout);
      data.showTimeout = null;
    }
    if (data.hideTimeout) {
      clearTimeout(data.hideTimeout);
      data.hideTimeout = null;
    }
    if (data.cleanupTimeout) {
      clearTimeout(data.cleanupTimeout);
      data.cleanupTimeout = null;
    }
    // Opening again (or any interrupt) cancels pending DOM teardown — remove nodes immediately or duplicate backdrops stack.
    if (data.pendingRemoval) {
      this.#finalizeTooltipDomRemoval(element);
    }
  }

  /**
   * Create and show tooltip
   */
  createTooltip(element, options) {
    if (!this.#isElementValid(element) || !this.portal) {
      return;
    }

    const data = this.activeTooltips.get(element);
    if (!data || data.tooltip) return;

    if (data.pendingRemoval) {
      this.#finalizeTooltipDomRemoval(element);
    }

    if (isMobileBreakpoint() && !this.#shouldUseMobileSheet(options)) {
      return;
    }

    // Check if element is still in viewport before creating tooltip
    if (!this.#isElementInViewport(element)) {
      return;
    }

    // Get content
    let content = options.content;
    if (options.isHtml) {
      const template = document.querySelector(content);
      content = template ? template.innerHTML : content;
    }

    if (!content) return;

    const useMobileSheet = this.#shouldUseMobileSheet(options);

    // Create tooltip element
    const tooltip = document.createElement("div");
    const tooltipId = `tooltip-${++this.tooltipIdCounter}`;
    tooltip.id = tooltipId;
    tooltip.className = this.#buildTooltipClasses(options);
    tooltip.setAttribute("role", "tooltip");

    if (useMobileSheet) {
      tooltip.classList.add("tooltip--mobile-sheet");
    }

    // Link tooltip to trigger element for accessibility
    if (element.id) {
      element.setAttribute("aria-describedby", tooltipId);
    } else {
      const triggerId = `tooltip-trigger-${this.tooltipIdCounter}`;
      element.id = triggerId;
      element.setAttribute("aria-describedby", tooltipId);
    }

    // Only set max-width if custom (ignored for mobile sheet — CSS full width)
    if (!useMobileSheet && options.maxWidth !== this.defaults.maxWidth) {
      tooltip.style.maxWidth = `${options.maxWidth}px`;
    }

    // Add content
    if (options.isHtml) {
      tooltip.innerHTML = content;
    } else {
      tooltip.textContent = content;
    }

    tooltip.querySelectorAll("[data-tooltip-close]").forEach((closeBtn) => {
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide(element);
      });
    });

    // Add arrow if enabled (hidden for bottom sheet)
    if (options.arrow && !useMobileSheet) {
      const arrow = document.createElement("div");
      arrow.setAttribute("data-tooltip-arrow", "");
      arrow.style.cssText = `
        position: absolute;
        width: 0;
        height: 0;
        border-style: solid;
      `;
      tooltip.appendChild(arrow);
    }

    // Check if element is inside an open dialog
    const dialog = element.closest("dialog");
    const isInDialog = dialog && dialog.open;

    if (useMobileSheet) {
      const backdrop = document.createElement("div");
      backdrop.className = "tooltip-mobile-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      const onBackdropClick = () => {
        this.hide(element);
      };
      backdrop.addEventListener("click", onBackdropClick);
      data.backdrop = backdrop;
      data.backdropClickHandler = onBackdropClick;

      if (isInDialog) {
        tooltip.style.position = "fixed";
        dialog.appendChild(backdrop);
        dialog.appendChild(tooltip);
      } else {
        this.portal.appendChild(backdrop);
        this.portal.appendChild(tooltip);
      }
      data.tooltip = tooltip;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          tooltip.classList.add("tooltip--visible");
        });
      });
    } else if (isInDialog) {
      // Append to dialog to ensure tooltip appears above dialog content
      // HTML5 dialog with showModal() creates a top layer, so tooltip must be inside dialog
      tooltip.style.position = "fixed";
      tooltip.style.zIndex = "2147483647"; // Maximum z-index
      dialog.appendChild(tooltip);
      data.tooltip = tooltip;

      // Position tooltip
      requestAnimationFrame(() => {
        const position = this.positionTooltip(element, tooltip, options);

        // Add position class for proper animation direction
        tooltip.classList.add(`tooltip--${position}`);

        // Show with animation
        requestAnimationFrame(() => {
          tooltip.classList.add("tooltip--visible");
        });
      });
    } else {
      // Append to portal for normal elements
      this.portal.appendChild(tooltip);
      data.tooltip = tooltip;

      // Position tooltip
      requestAnimationFrame(() => {
        const position = this.positionTooltip(element, tooltip, options);

        // Add position class for proper animation direction
        tooltip.classList.add(`tooltip--${position}`);

        // Show with animation
        requestAnimationFrame(() => {
          tooltip.classList.add("tooltip--visible");
        });
      });
    }

    // Set up interactive tooltip events
    if (options.interactive) {
      tooltip.addEventListener("mouseenter", () => {
        this.clearTimeouts(element);
      });
      tooltip.addEventListener("mouseleave", () => {
        this.hide(element);
      });
    }
  }

  /**
   * Position tooltip relative to trigger element
   */
  positionTooltip(element, tooltip, options) {
    if (!this.#isElementValid(element) || !tooltip) {
      return "bottom";
    }

    let triggerRect;
    let tooltipRect;

    try {
      triggerRect = element.getBoundingClientRect();
      tooltipRect = tooltip.getBoundingClientRect();
    } catch (error) {
      return "bottom";
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let position = options.position;
    let x, y;

    // Auto positioning logic
    if (position === "auto") {
      const spaceTop = triggerRect.top;
      const spaceBottom = viewportHeight - triggerRect.bottom;
      const spaceLeft = triggerRect.left;
      const spaceRight = viewportWidth - triggerRect.right;

      if (spaceBottom >= tooltipRect.height + options.offset) {
        position = "bottom";
      } else if (spaceTop >= tooltipRect.height + options.offset) {
        position = "top";
      } else if (spaceRight >= tooltipRect.width + options.offset) {
        position = "right";
      } else if (spaceLeft >= tooltipRect.width + options.offset) {
        position = "left";
      } else {
        position = "bottom"; // fallback
      }
    }

    // Calculate position (portal is fixed, so use viewport coordinates)
    switch (position) {
      case "top":
        x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        y = triggerRect.top - tooltipRect.height - options.offset;
        break;
      case "bottom":
        x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        y = triggerRect.bottom + options.offset;
        break;
      case "left":
        x = triggerRect.left - tooltipRect.width - options.offset;
        y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        break;
      case "right":
        x = triggerRect.right + options.offset;
        y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        break;
      default:
        x = triggerRect.left;
        y = triggerRect.bottom + options.offset;
    }

    // Store original coordinates for arrow positioning
    const originalX = x;
    const originalY = y;

    // Constrain to viewport
    x = Math.max(8, Math.min(x, viewportWidth - tooltipRect.width - 8));
    y = Math.max(8, Math.min(y, viewportHeight - tooltipRect.height - 8));

    // Apply position (no compensation needed since we measured at scale(1))
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;

    // Add arrow if enabled and position it correctly
    if (options.arrow) {
      const arrow = tooltip.querySelector("[data-tooltip-arrow]") || this.#createArrow();
      if (!tooltip.contains(arrow)) {
        tooltip.appendChild(arrow);
      }

      // Adjust arrow position based on constraint offset
      this.#positionArrow(arrow, position, triggerRect, { x, y, originalX, originalY }, tooltipRect);
    }

    return position;
  }

  /**
   * Create arrow element
   */
  #createArrow() {
    const arrow = document.createElement("div");
    arrow.setAttribute("data-tooltip-arrow", "");
    return arrow;
  }

  /**
   * Position arrow with offset correction for viewport constraints
   */
  #positionArrow(arrow, position, triggerRect, coords, tooltipRect) {
    const { x, y, originalX, originalY } = coords;

    // Calculate offset caused by viewport constraints
    const offsetX = x - originalX;
    const offsetY = y - originalY;

    // Calculate arrow position relative to trigger
    let arrowOffset = 0;

    switch (position) {
      case "top":
      case "bottom":
        // For top/bottom, adjust arrow horizontal position
        const triggerCenterX = triggerRect.left + triggerRect.width / 2;
        const tooltipLeft = coords.x; // Use final compensated position
        arrowOffset = triggerCenterX - tooltipLeft;

        // Constrain arrow within tooltip bounds (with some padding)
        const minOffset = 12; // Arrow size + padding
        const maxOffset = tooltipRect.width - 12;
        arrowOffset = Math.max(minOffset, Math.min(arrowOffset, maxOffset));

        arrow.style.left = `${arrowOffset}px`;
        arrow.style.right = "";
        arrow.style.top = "";
        arrow.style.bottom = "";
        arrow.style.transform = "translateX(-50%)";
        break;

      case "left":
      case "right":
        // For left/right, adjust arrow vertical position
        const triggerCenterY = triggerRect.top + triggerRect.height / 2;
        const tooltipTop = coords.y; // Use final compensated position
        arrowOffset = triggerCenterY - tooltipTop;

        // Constrain arrow within tooltip bounds
        const minOffsetY = 12;
        const maxOffsetY = tooltipRect.height - 12;
        arrowOffset = Math.max(minOffsetY, Math.min(arrowOffset, maxOffsetY));

        arrow.style.top = `${arrowOffset}px`;
        arrow.style.bottom = "";
        arrow.style.left = "";
        arrow.style.right = "";
        arrow.style.transform = "translateY(-50%)";
        break;
    }
  }

  /**
   * Remove tooltip + backdrop nodes after close animation (or immediately when cleanup timeout was cancelled).
   */
  #finalizeTooltipDomRemoval(element) {
    const data = this.activeTooltips.get(element);
    if (!data?.pendingRemoval) {
      return;
    }

    const { backdrop, tooltip } = data.pendingRemoval;

    try {
      if (backdrop?.parentNode) {
        backdrop.parentNode.removeChild(backdrop);
      }
      if (tooltip?.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    } catch (error) {
      // Element may have been removed already
    }

    data.pendingRemoval = null;
    data.cleanupTimeout = null;
  }

  /**
   * Destroy tooltip
   */
  destroyTooltip(element) {
    const data = this.activeTooltips.get(element);
    if (!data) {
      return;
    }

    if (data.pendingRemoval) {
      this.#finalizeTooltipDomRemoval(element);
    }

    if (!data.tooltip) {
      return;
    }

    const tooltip = data.tooltip;
    const backdrop = data.backdrop;

    // Remove aria-describedby from trigger element
    if (this.#isElementValid(element)) {
      const tooltipId = tooltip.id;
      if (element.getAttribute("aria-describedby") === tooltipId) {
        element.removeAttribute("aria-describedby");
        // Remove auto-generated ID if it was created by us
        if (element.id && element.id.startsWith("tooltip-trigger-")) {
          element.removeAttribute("id");
        }
      }
    }

    if (backdrop && data.backdropClickHandler) {
      backdrop.removeEventListener("click", data.backdropClickHandler);
      data.backdropClickHandler = null;
    }

    const isMobileSheet = tooltip.classList.contains("tooltip--mobile-sheet");

    // Sheet: add --closing before removing --visible so :has() backdrop rules stay continuous (see _component-tooltip.scss)
    if (isMobileSheet) {
      tooltip.classList.add("tooltip--closing");
    }
    tooltip.classList.remove("tooltip--visible");

    const removeDelay = isMobileSheet ? this.mobileSheetCloseMs : 200;

    data.pendingRemoval = { backdrop, tooltip };

    data.cleanupTimeout = setTimeout(() => {
      this.#finalizeTooltipDomRemoval(element);
    }, removeDelay);

    data.tooltip = null;
    data.backdrop = null;
  }

  /**
   * Check if element is still in DOM and valid
   */
  #isElementValid(element) {
    return element && document.contains(element);
  }

  /**
   * Check if element is visible in viewport
   */
  #isElementInViewport(element) {
    if (!this.#isElementValid(element)) {
      return false;
    }

    try {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

      // Element is considered in viewport if any part is visible
      return rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update positions of all active tooltips
   */
  updatePositions() {
    const invalidElements = [];

    this.activeTooltips.forEach((data, element) => {
      if (!this.#isElementValid(element)) {
        invalidElements.push(element);
        return;
      }

      if (data.tooltip) {
        if (data.tooltip.classList.contains("tooltip--mobile-sheet")) {
          return;
        }

        // Check if element is still in viewport
        if (this.#isElementInViewport(element)) {
          try {
            this.positionTooltip(element, data.tooltip, data.options);
          } catch (error) {
            // If positioning fails, remove element
            invalidElements.push(element);
          }
        } else {
          // Element scrolled out of viewport, hide tooltip
          this.destroyTooltip(element);
        }
      }
    });

    // Cleanup invalid elements
    invalidElements.forEach((element) => {
      this.unbindElement(element);
    });
  }

  /**
   * Bind global events
   */
  bindGlobalEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    document.addEventListener("keydown", this.handleKeydown);
    document.addEventListener("click", this.handleDocumentClick);
  }

  /**
   * Observe DOM for new tooltip elements
   */
  observeDOM() {
    if (!window.MutationObserver) return;

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      const removedElements = new Set();

      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          // Check for added nodes
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // Element node
              if (
                node.hasAttribute?.("data-tooltip") ||
                node.hasAttribute?.("data-tooltip-html") ||
                node.querySelector?.("[data-tooltip], [data-tooltip-html]")
              ) {
                shouldScan = true;
              }
            }
          });

          // Check for removed nodes and cleanup
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // Check if removed node is a bound element
              if (this.activeTooltips.has(node)) {
                removedElements.add(node);
              }
              // Check if removed node contains bound elements
              const boundElements = node.querySelectorAll?.("[data-tooltip], [data-tooltip-html]");
              if (boundElements) {
                boundElements.forEach((el) => {
                  if (this.activeTooltips.has(el)) {
                    removedElements.add(el);
                  }
                });
              }
            }
          });
        }
      });

      // Cleanup removed elements
      removedElements.forEach((element) => {
        this.unbindElement(element);
      });

      if (shouldScan) {
        requestIdleCallback(() => this.scanAndBind());
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Public API methods
   */

  /**
   * Manually show tooltip
   */
  showTooltip(element, content, options = {}) {
    const merged = { ...this.defaults, ...options, content };
    if (isMobileBreakpoint() && !this.#shouldUseMobileSheet(merged)) {
      return;
    }

    if (!this.activeTooltips.has(element)) {
      // Create temporary tooltip data
      this.activeTooltips.set(element, {
        options: merged,
        tooltip: null,
        backdrop: null,
        backdropClickHandler: null,
        pendingRemoval: null,
        showTimeout: null,
        hideTimeout: null,
        handlers: {},
        touchClickMode: merged.trigger === "hover" && (isTouch() || isMobileBreakpoint()),
      });
    }

    this.show(element, { content, ...options });
  }

  /**
   * Manually hide tooltip
   */
  hideTooltip(element) {
    this.hide(element);
  }

  /**
   * Destroy tooltip system
   */
  destroy() {
    this.hideAll();

    // Disconnect MutationObserver
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Unbind all elements
    this.activeTooltips.forEach((data, element) => {
      this.unbindElement(element);
    });

    if (this.portal) {
      this.portal.remove();
      this.portal = null;
    }

    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("scroll", this.handleScroll);
    document.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("click", this.handleDocumentClick);

    this.activeTooltips.clear();
    this.initialized = false;
  }
}

// Create global tooltip instance
export const Tooltip = new TooltipManager();

// Auto-initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Tooltip.init());
} else {
  requestIdleCallback(() => Tooltip.init());
}

// Scan for tooltips when dialog opens (to handle dynamically loaded content)
document.addEventListener("dialog:open", (event) => {
  if (Tooltip.initialized) {
    // Use setTimeout to ensure dialog content is fully rendered
    setTimeout(() => {
      // event.target is the dialog-component element
      const dialogComponent = event.target;
      const dialog =
        dialogComponent?.querySelector?.("dialog[ref='dialog']") || dialogComponent?.querySelector?.("dialog");

      if (dialog) {
        // Only scan within the dialog that just opened (more efficient)
        Tooltip.scanAndBind(dialog);
      } else {
        // Fallback: scan entire document if dialog not found
        Tooltip.scanAndBind();
      }
    }, 0);
  }
});

// ============================================================================
// Scroll Utilities
// ============================================================================

// Cache Safari detection results (userAgent doesn't change)
let _isSafariCached = null;
let _safariVersionCached = undefined;

/**
 * Detect Safari browser (cached)
 * @returns {boolean}
 */
export function isSafari() {
  if (_isSafariCached !== null) return _isSafariCached;
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  _isSafariCached = ua.indexOf("safari") >= 0 && ua.indexOf("chrome") < 0 && ua.indexOf("android") < 0;
  return _isSafariCached;
}

/**
 * Get Safari version info (cached)
 * @returns {{ major: number, minor: number, full: string } | null}
 */
export function getSafariVersion() {
  if (_safariVersionCached !== undefined) return _safariVersionCached;
  if (!isSafari()) {
    _safariVersionCached = null;
    return null;
  }
  const match = navigator.userAgent.match(/Version\/([\d.]+)/);
  if (!match) {
    _safariVersionCached = null;
    return null;
  }
  const [major, minor] = match[1].split(".").map(Number);
  _safariVersionCached = { major, minor, full: match[1] };
  return _safariVersionCached;
}

let _lenis = null;
let _lenisLoading = null;

/**
 * Whether smooth scrolling should run at all, in priority order.
 *
 * The visitor's preference comes FIRST and the merchant cannot overrule it:
 * smoothing the page is motion, and someone who asked their device for less of
 * it means the whole page, not just the decoration.
 *
 * The two device exclusions are not conservatism, they are where Lenis has
 * nothing to add: it smooths WHEEL input, and touch scrolling is already
 * continuous and native, so on a phone it would cost bytes and a rAF loop to
 * change nothing. Safari is excluded because its own wheel scrolling is already
 * eased, so Lenis would be smoothing something smooth — two easings fighting,
 * for a worse result than either alone.
 *
 * @returns {boolean}
 */
export function isSmoothScrollEnabled() {
  if (prefersReducedMotion()) return false;

  // The theme editor drives the preview's scrolling itself — selecting a section
  // scrolls it into view, and the merchant resizes the frame constantly. Smooth
  // scrolling there fights the editor for no merchant benefit.
  if (window.Shopify?.designMode) return false;

  // `(pointer: fine)` rather than "has a touchscreen": a Windows laptop with a
  // touch screen reports maxTouchPoints > 0 while the person is using a wheel,
  // and testing for touch excluded exactly the machines this feature is for.
  // The media query asks about the PRIMARY pointer, which is the mouse there.
  if (!window.matchMedia("(pointer: fine)").matches) return false;
  if (isMobileBreakpoint() || isTabletBreakpoint()) return false;

  // Safari eases its own wheel scrolling already, so Lenis would be smoothing
  // something smooth — two easings fighting, worse than either alone.
  if (isSafari()) return false;

  return window.FoxTheme?.settings?.smoothScroll === true;
}

/**
 * The shared Lenis instance, or null when smooth scrolling is off.
 *
 * Synchronous by contract: every caller in the theme is written as
 * `lenis ? lenis.scroll : window.scrollY`, so returning null while the dynamic
 * import is still in flight is a supported answer rather than a miss. The
 * library is only fetched once this returns a first `true` from the gate, so a
 * store with the setting off never downloads it.
 *
 * @returns {import("@theme/lenis").Lenis | null}
 */
export function getLenis() {
  if (!isSmoothScrollEnabled()) return null;
  if (_lenis) return _lenis;
  if (_lenisLoading) return null;

  _lenisLoading = import("@theme/lenis")
    .then(({ Lenis }) => {
      // The gate is re-checked: the import is async, and the theme editor can
      // flip the setting or the viewport can cross a breakpoint in between.
      if (!Lenis || _lenis || !isSmoothScrollEnabled()) return null;

      // `autoToggle` is what makes this fit the theme rather than fight it: with
      // it, stop/start is expressed as `overflow` on the root, and Lenis watches
      // that property. Both of the theme's lock mechanisms already write it —
      // `html.scroll-locked` from the dozen `<dialog scroll-lock>` overlays, and
      // `html:has(.dropdown-open, .search-open)` from the header — so every
      // overlay stops the smoothing for free, including ones not written yet.
      // A MutationObserver on the lock attribute was the obvious alternative and
      // is strictly worse: it cannot see the `:has()` rule, which never touches
      // an attribute on `html`.
      // `allowNestedScroll` is not optional here. Lenis swallows the wheel event
      // whenever it is STOPPED — `if (this.isStopped || this.isLocked)
      // event.preventDefault()` — so "the overlay locked the page, therefore
      // Lenis is out of the way" is false: it is stopped AND still eating the
      // event, which kills native scrolling inside the overlay. The cart drawer's
      // item list stops scrolling entirely. With this on, Lenis measures the
      // node under the pointer and steps aside for a real scroller before it
      // reaches that branch — no `data-lenis-prevent` to scatter through the
      // markup and no component list to keep in sync.
      // No `lerp` here, though every reference implementation pairs it with
      // `duration`. Lenis picks ONE model in `advance()` — `if (duration &&
      // easing) … else if (lerp)` — and it ships a default easing, so the
      // duration branch always wins and a `lerp` alongside it never runs.
      // Measured by constructing an instance with both and reading back which
      // branch applies. Carrying it would have been a knob that looks tunable
      // and does nothing.
      _lenis = new Lenis({
        autoRaf: true,
        autoToggle: true,
        allowNestedScroll: true,
        smoothWheel: true,
        duration: 0.6,
      });
      // No marker class is set here on purpose: Lenis REWRITES html.className
      // whenever its state changes, so anything the theme adds survives only
      // until the first scroll. Style against Lenis's own `.lenis` instead.

      return _lenis;
    })
    .catch(() => null)
    .finally(() => {
      _lenisLoading = null;
    });

  return null;
}

/**
 * Helper to remove scroll-lock classes
 * @param {Element} element - The element to remove class from
 * @param {string} className - The class name to remove
 * @param {Function} [shouldRemove] - Optional function to check if class should still be removed
 */
export function removeScrollLockClass(element, className, shouldRemove) {
  if (!shouldRemove || shouldRemove()) {
    element.classList.remove(className);
  }
}

// ============================================================================
// Public API
// ============================================================================

// Ensure FoxTheme object exists
if (typeof window.FoxTheme === "undefined") {
  window.FoxTheme = {};
}
if (typeof window.FoxTheme.utilities === "undefined") {
  window.FoxTheme.utilities = {};
}

FoxTheme.utilities = {
  ...FoxTheme.utilities,
  scheduler: scheduler,
  Tooltip: Tooltip,
  getLenis: getLenis,
  removeScrollLockClass: removeScrollLockClass,
};

// ============================================================================
// Motion Coordinator Integration
// ============================================================================

import { motionCoordinator } from "@theme/motion-coordinator";
import { MOBILE_MAX_WIDTH } from "@theme/motion-presets";

/**
 * Coordinated IntersectionObserver wrapper
 * Drop-in replacement for inView() with performance benefits
 * Uses shared observer instead of creating new one per element
 *
 * @param {Element} element - Element to observe
 * @param {Function} callback - Callback when element enters viewport. It holds a
 *   budget slot for as long as its promise takes, so RETURN the animation's
 *   promise — a callback that resolves before the animation ends is not budgeted.
 * @param {Function} [onSkip] - Called instead when the animation budget is full
 *   and this element will not get a slot. MUST make the element visible: the
 *   budget may drop an animation, never a piece of content.
 * @param {Function} [prepare] - Optional async step run once the element is in
 *   view but BEFORE the budget is consulted — for waiting on media, which costs
 *   no GPU and so must not occupy a slot.
 * @returns {Function} Cleanup function
 */
export function coordinatedInView(element, callback, options = {}) {
  const { onSkip, onExit, repeat, prepare } = typeof options === "function" ? { onSkip: options } : options;

  return motionCoordinator.registerElement(element, {
    onActivate: callback,
    prepare,
    onSkip,
    onExit,
    repeat,
    type: element.dataset?.motion, // Pass animation type for smart limits
  });
}

/**
 * Read a motion token off :root and return it in milliseconds.
 *
 * The entrance tokens are CSS <time> values (`0.6s`, `350ms`) because that is
 * what the rest of the stylesheet consumes, while WAAPI and Motion both want a
 * number. `Number("0.6s")` is NaN, and a NaN duration animates instantly with
 * no error thrown — so parse the unit rather than coercing.
 *
 * @param {string} name - Custom property name, e.g. "--motion-swap"
 * @param {number} fallback - Milliseconds to use when the token is absent or unparseable
 * @param {Element} [el] - Element to resolve against; see motionToken()
 * @returns {number} Duration in milliseconds
 */
export function motionDurationMs(name, fallback, el = document.documentElement) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;

  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallback;

  // A bare number is ambiguous, so treat it as the seconds a CSS <time> implies
  // only when it carries the unit; anything else falls back rather than guessing.
  if (raw.endsWith("ms")) return value;
  if (raw.endsWith("s")) return value * 1000;
  return fallback;
}

/**
 * Read a motion token as a raw string (easing curve, travel distance),
 * resolved against `el` rather than against :root.
 *
 * These are custom properties, so they INHERIT. Reading them off the document
 * element ignored any override an author put on a section or a list, while the
 * generated prestage CSS honoured it — a `var()` inside a rule resolves against
 * the element the rule matches. The element then prestaged at one offset and
 * tweened from another, which is a jump on the first frame. Measured on a card
 * grid whose list set `--motion-distance: 8rem`: the card's own computed value
 * read 8rem and it travelled the root's 40px.
 *
 * Omitting `el` keeps the previous behaviour exactly. With no override in
 * between, an element resolves the same value :root holds — which is why every
 * call site could pass its own element without changing a single existing
 * theme.
 *
 * @param {string} name - Custom property name
 * @param {string} fallback - Value to use when the token is absent
 * @param {Element} [el] - Element to resolve against; defaults to the document element
 * @returns {string}
 */
export function motionToken(name, fallback, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** @type {boolean | null} Cached answer of isMotionMobile(). */
let motionMobileMatches = null;

/**
 * Small-screen motion policy, evaluated against the SAME number the generated
 * prestage CSS uses — if these two ever disagree the CSS paints one start state
 * and the animation tweens from another, which is a jump on the first frame.
 *
 * @returns {boolean}
 */
export function isMotionMobile() {
  // One MediaQueryList for the page, its answer kept current by its own change
  // event. Calling matchMedia() per read built a new list every time and forced
  // a style recalc whenever a write was pending — on a phone at load, every
  // motion-group read it twice right after setting a style, and the recalcs
  // showed up as forced layout in motion-group.js's module evaluation.
  if (motionMobileMatches === null) {
    const query = window.matchMedia?.(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    motionMobileMatches = Boolean(query?.matches);
    query?.addEventListener?.("change", (event) => {
      motionMobileMatches = event.matches;
    });
  }
  return motionMobileMatches;
}

/** Milliseconds per duration token, for a page that never emitted the tokens. */
export const MOTION_DURATION_FALLBACK_MS = { swap: 600, reveal: 1500, "media-reveal": 1300 };

/**
 * The theme's entrance vocabulary, resolved from `el` — the one place that
 * decides how anything in this theme appears. Every entrance shares the easing
 * pair; only the duration is contextual, which is why it is the argument.
 *
 * It no longer resolves the travel distance. That is the stylesheet's, and
 * returning it here meant a getComputedStyle read per entrance for a value no
 * caller had read since the start state moved into CSS.
 *
 * How the two halves of an entrance relate is decided here, not at each call
 * site:
 *
 * 1. The opacity rides the MOVEMENT's curve (--motion-ease-entrance-fade, when
 *    set, overrides it). On a decelerating curve the element is mostly visible
 *    after the first few hundred milliseconds and the eye then follows the rise
 *    as it settles; a linear fade under the same rise left most of the travel
 *    happening while the element was too faint to see it.
 * 2. The opacity runs over --motion-fade-ratio of the movement's duration — 1
 *    by default, so the two stay in step for the whole run.
 *
 * @param {string} durationName - Duration token for the MOVEMENT
 * @param {number} fallbackMs - Milliseconds to use when that token is missing
 * @param {Element} [el] - Element to resolve the tokens against; see motionToken()
 * @param {string} [easingName] - Curve token for the movement; falls back to
 *   --motion-ease-entrance when that token is not set (the zooms pass
 *   --motion-ease-zoom, which ships unset)
 * @returns {{ durationMs: number, fadeDurationMs: number, easing: string, fadeEasing: string }}
 */
export function entranceMotion(
  durationName = "--motion-swap",
  fallbackMs = 600,
  el = document.documentElement,
  easingName = "--motion-ease-entrance"
) {
  const durationMs = motionDurationMs(durationName, fallbackMs, el);
  const entrance = motionToken("--motion-ease-entrance", "cubic-bezier(0.16, 1, 0.3, 1)", el);
  const ratio = Number.parseFloat(motionToken("--motion-fade-ratio", "1", el));
  const fadeRatio = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0.05), 1) : 1;
  const easing = easingName === "--motion-ease-entrance" ? entrance : motionToken(easingName, entrance, el);

  return {
    durationMs,
    fadeDurationMs: durationMs * fadeRatio,
    easing,
    fadeEasing: motionToken("--motion-ease-entrance-fade", easing, el),
  };
}

/**
 * Check if the document is in RTL direction
 * @returns boolean
 */
export function isRTL() {
  return document.documentElement.getAttribute("dir") === "rtl";
}

/**
 * A custom ResizeObserver that only calls the callback when the element is resized.
 * By default the ResizeObserver callback is called when the element is first observed.
 */
export class ResizeNotifier extends ResizeObserver {
  #initialized = false;

  /** @param {ResizeObserverCallback} callback */
  constructor(callback) {
    super((entries) => {
      if (this.#initialized) return callback(entries, this);
      this.#initialized = true;
    });
  }

  disconnect() {
    this.#initialized = false;
    super.disconnect();
  }
}

// Start Lenis as early as the gate allows, rather than on whichever component
// happens to ask for it first. `getLenis()` answers null while the dynamic
// import is in flight — a supported answer, since every caller is written as
// `lenis ? lenis.scroll : window.scrollY` and native scroll events keep firing
// under Lenis — but which answer a component gets would otherwise depend on
// network speed. Kicking the import off here makes the instance ready before
// components connect in the common case, so the theme takes one path rather
// than two at random. The gate still guards it, so a store with the setting off
// downloads nothing.
(() => {
  const warm = () => {
    if (isSmoothScrollEnabled()) getLenis();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", warm, { once: true });
  else warm();
})();
