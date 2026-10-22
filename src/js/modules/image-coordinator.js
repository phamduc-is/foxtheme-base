/**
 * Image Coordinator - Optimize ResponsiveImage performance
 * Reduces N IntersectionObservers + N ResizeObservers to 1 shared of each
 *
 * Benefits:
 * - 99% memory reduction (100 images: 200 observers → 2 observers)
 * - Better scroll performance (1 callback vs N callbacks)
 * - Priority loading (above-fold images first)
 *
 * Browser Support:
 * - IntersectionObserver: Safari 12.1+, Firefox 55+, Edge 15+
 * - ResizeObserver: Safari 13.1+, Firefox 69+, Edge 79+
 * - Fallback included for ResizeObserver
 */

/**
 * @capability Shared observer pool for images — a single IntersectionObserver (lazy load, fires before the viewport) plus a single ResizeObserver (RAF-throttled width callbacks, sub-pixel noise filtered) serving all responsive images, instead of one observer pair per image.
 * @when Any component that lazy-loads media or needs an image/wrapper width on resize — register with @theme/image-coordinator instead of creating its own IntersectionObserver/ResizeObserver (this is what the responsive-image element uses).
 * @contract import { imageCoordinator } from "@theme/image-coordinator"; const cleanup = imageCoordinator.registerLazyLoad(img, { onIntersect }) or imageCoordinator.registerResize(target, img, onWidthChange); call the returned cleanup function in disconnectedCallback. Singleton, also exposed as window.FoxTheme.imageCoordinator for debugging (getStats()).
 * @keywords image coordinator, lazy load, IntersectionObserver, ResizeObserver, shared observer, responsive image, viewport, resize width, performance
 */
class ImageCoordinator {
  constructor() {
    // Shared observers
    this.io = null; // IntersectionObserver for lazy load
    this.ro = null; // ResizeObserver for size calculations

    // Element tracking. Lazy-load and resize registrations are SEPARATE maps:
    // they used to share one entry per image, and the lazy side deleted the
    // whole entry once the image intersected — taking the resize callback with
    // it, so `sizes` was never recomputed after the image had loaded.
    this.lazy = new Map(); // image -> onIntersect
    this.resize = new Map(); // image -> { target, onResize, lastWidth }
    this.resizeTargets = new Map(); // target -> Set<image> (reverse index for handleResize)
    this.resizeRAFs = new Map(); // image -> rafId (throttle resize)

    // Configuration
    this.config = {
      // IntersectionObserver config
      // A positive bottom margin starts the request BEFORE the image scrolls
      // into view. The previous "-5%" was negative — it waited until the image
      // was already 5% inside the viewport, so every scroll-in showed the grey
      // placeholder for a full network round-trip. 200px was the next value:
      // on Fast 4G that still showed grey for ~0.7s on every scroll-in (request
      // at 19ms, bytes at ~300ms, faded in at ~700ms), because 200px is less
      // than one flick of the wheel. One viewport ahead (a percentage is
      // measured against the root) is what native loading=lazy budgets on a
      // fast connection, and it lands the bytes before the zoom reveal plays.
      lazyLoadMargin: "0px 0px 100% 0px",
      lazyLoadThreshold: 0.01, // Trigger when 1% visible

      // ResizeObserver throttle
      resizeThrottle: 16, // ~60fps max
    };
  }

  /**
   * Initialize shared observers
   */
  init() {
    if (this.io && this.ro) return;

    // Initialize IntersectionObserver for lazy loading
    if (!this.io && "IntersectionObserver" in window) {
      this.io = new IntersectionObserver((entries) => this.handleIntersections(entries), {
        rootMargin: this.config.lazyLoadMargin,
        threshold: this.config.lazyLoadThreshold,
      });
    }

    // Initialize ResizeObserver for dynamic sizes
    if (!this.ro && "ResizeObserver" in window) {
      this.ro = new ResizeObserver((entries) => this.handleResize(entries));
    } else if (!this.ro) {
      // Fallback for Safari < 13.1 (very rare)
      this.setupResizeFallback();
    }
  }

  /**
   * Register image for coordinated lazy loading
   * @param {HTMLImageElement} element - The responsive image
   * @param {Object} options - { onIntersect: callback }
   * @returns {Function} Cleanup function
   */
  registerLazyLoad(element, options = {}) {
    if (!this.io) this.init();

    // Fallback if no IntersectionObserver support
    if (!this.io) {
      options.onIntersect?.();
      return () => {};
    }

    this.lazy.set(element, options.onIntersect);

    // Observe with shared IntersectionObserver
    this.io.observe(element);

    // Return cleanup function
    return () => this.unregisterLazyLoad(element);
  }

  /**
   * Register element for coordinated resize observation
   * @param {HTMLElement} target - The element to observe (wrapper or image)
   * @param {HTMLImageElement} image - The responsive image
   * @param {Function} callback - Called with width when resized
   * @returns {Function} Cleanup function
   */
  registerResize(target, image, callback) {
    if (!this.ro) this.init();

    // Fallback if no ResizeObserver support
    if (!this.ro) {
      // Call immediately with current width
      callback(target.offsetWidth || 0);
      return () => {};
    }

    this.resize.set(image, { target, onResize: callback, lastWidth: 0 });

    let images = this.resizeTargets.get(target);
    if (!images) {
      images = new Set();
      this.resizeTargets.set(target, images);
      // Observe target with shared ResizeObserver (once per target)
      this.ro.observe(target);
    }
    images.add(image);

    // Return cleanup function
    return () => this.unregisterResize(target, image);
  }

  /**
   * Unregister lazy load
   * @param {HTMLImageElement} element
   */
  unregisterLazyLoad(element) {
    if (this.io) {
      this.io.unobserve(element);
    }
    this.lazy.delete(element);
  }

  /**
   * Unregister resize observation
   * @param {HTMLElement} target
   * @param {HTMLImageElement} image
   */
  unregisterResize(target, image) {
    this.resize.delete(image);

    const images = this.resizeTargets.get(target);
    if (images) {
      images.delete(image);
      if (images.size === 0) {
        this.resizeTargets.delete(target);
        if (this.ro) this.ro.unobserve(target);
      }
    }

    // Cancel pending RAF
    const rafId = this.resizeRAFs.get(image);
    if (rafId) {
      cancelAnimationFrame(rafId);
      this.resizeRAFs.delete(image);
    }
  }

  /**
   * Handle IntersectionObserver entries
   * @param {IntersectionObserverEntry[]} entries
   */
  handleIntersections(entries) {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const element = entry.target;
      if (!this.lazy.has(element)) return;
      const onIntersect = this.lazy.get(element);

      // Stop observing (one-time load)
      this.unregisterLazyLoad(element);

      // Execute callback
      try {
        onIntersect?.();
      } catch (error) {
        console.error("[ImageCoordinator] Intersection callback error:", error);
      }
    });
  }

  /**
   * Handle ResizeObserver entries
   * @param {ResizeObserverEntry[]} entries
   */
  handleResize(entries) {
    entries.forEach((entry) => {
      const images = this.resizeTargets.get(entry.target);
      if (!images) return;

      for (const image of images) {
        // Throttle with RAF (prevent layout thrashing)
        if (this.resizeRAFs.has(image)) continue;

        const rafId = requestAnimationFrame(() => {
          this.resizeRAFs.delete(image);

          const data = this.resize.get(image);
          if (!data) return;

          const width = Math.ceil(entry.contentRect.width || 0);
          const lastWidth = data.lastWidth || 0;

          // Only notify if width changed significantly (avoid sub-pixel noise)
          if (Math.abs(width - lastWidth) < 1) return;

          data.lastWidth = width;

          try {
            data.onResize?.(width);
          } catch (error) {
            console.error("[ImageCoordinator] Resize callback error:", error);
          }
        });

        this.resizeRAFs.set(image, rafId);
      }
    });
  }

  /**
   * Fallback for browsers without ResizeObserver (Safari < 13.1)
   */
  setupResizeFallback() {
    let timeout;
    const handleWindowResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Notify all resize-tracked images
        for (const data of this.resize.values()) {
          const width = data.target.offsetWidth || 0;
          const lastWidth = data.lastWidth || 0;

          if (Math.abs(width - lastWidth) < 1) continue;

          data.lastWidth = width;

          try {
            data.onResize(width);
          } catch (error) {
            console.error("[ImageCoordinator] Resize fallback error:", error);
          }
        }
      }, 100);
    };

    window.addEventListener("resize", handleWindowResize);
  }

  /**
   * Get statistics for debugging
   * @returns {Object}
   */
  getStats() {
    return {
      lazy: this.lazy.size,
      resize: this.resize.size,
      resizeTargets: this.resizeTargets.size,
      observers: {
        io: this.io ? "initialized" : "not initialized",
        ro: this.ro ? "initialized" : "fallback",
      },
      pendingRAFs: this.resizeRAFs.size,
    };
  }

  /**
   * Destroy coordinator and cleanup
   */
  destroy() {
    // Disconnect observers
    if (this.io) {
      this.io.disconnect();
      this.io = null;
    }

    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }

    // Cancel all pending RAFs
    for (const rafId of this.resizeRAFs.values()) {
      cancelAnimationFrame(rafId);
    }

    // Clear all tracking
    this.lazy.clear();
    this.resize.clear();
    this.resizeTargets.clear();
    this.resizeRAFs.clear();
  }
}

// Export singleton instance
export const imageCoordinator = new ImageCoordinator();

// Expose to window for debugging
if (typeof window !== "undefined") {
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.imageCoordinator = imageCoordinator;
}
