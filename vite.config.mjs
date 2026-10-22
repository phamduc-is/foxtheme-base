import { defineConfig } from "vite";

// Multi-entry build: build all entries in one run
// Note: CSS files (like swiper.css) are built from SCSS files, not from vite
export default defineConfig(() => {
  const entries = {
    swiper: "src/js/library/swiper.js",
    animation: "src/js/library/animation.js",
    "custom-elements": "src/js/library/custom-elements.js",
    photoswipe: "src/js/library/photoswipe.js",
    lenis: "src/js/library/lenis.js",
  };

  return {
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    },
    build: {
      lib: {
        entry: entries,
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      // Don't minify here - we use terser for consistent minification
      // minify: false is default, but explicit for clarity
      minify: false,
      outDir: "src/js/modules",
      emptyOutDir: false,
      rollupOptions: {
        // Don't externalize motion - bundle it into animation.js
        external: (id) => {
          // Externalize node_modules except motion
          if (id.startsWith("node_modules/") && !id.includes("motion")) {
            return false;
          }
          return false; // Bundle everything, including motion
        },
        output: {
          // Ensure deterministic output
          generatedCode: {
            constBindings: true,
            objectShorthand: false,
            arrowFunctions: false,
          },
          // Preserve module structure for consistency
          preserveModules: false,
          // Ensure consistent chunk naming
          chunkFileNames: "[name].js",
          // Sort modules for deterministic output
          manualChunks: undefined,
        },
        // Ensure deterministic module resolution
        treeshake: {
          moduleSideEffects: (id) => {
            // Preserve side effects for polyfills like @ungap/custom-elements
            if (id.includes("@ungap/custom-elements")) {
              return true;
            }
            return false;
          },
        },
      },
    },
  };
});
