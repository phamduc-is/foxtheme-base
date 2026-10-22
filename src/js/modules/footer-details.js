if (!customElements.get("footer-details")) {
  customElements.define(
    "footer-details",
    class FooterDetails extends HTMLDetailsElement {
      constructor() {
        super();
      }

      get accordionEl() {
        return (this._accordionEl = this._accordionEl || this.closest("accordion-component"));
      }

      connectedCallback() {
        this.openDefault = this.dataset.openDefault === "true";

        const mqlTablet = window.matchMedia("screen and (max-width: 1023px)");
        const updateOpen = (isTablet) => {
          const shouldOpen = isTablet ? this.openDefault : true;

          if (this.open === shouldOpen) return;

          // Check if accordion component exists and has refs initialized
          const accordionEl = this.accordionEl;
          if (!accordionEl || !accordionEl.refs) {
            console.warn("footer-details: accordion-component not found or refs not initialized");
            return;
          }

          const { item: items, summary: summaries, content: contents } = accordionEl.refs;

          // Fallback if refs are not available
          if (!items || !summaries || !contents) {
            // Use DOM query as fallback
            const item = this.closest("details") || this;
            const summary = item.querySelector("summary");
            const content = item.querySelector(".accordion__content");

            if (accordionEl.toggleOpen && item && summary && content) {
              accordionEl.toggleOpen({
                willOpen: shouldOpen,
                item,
                summary,
                content,
              });
            }
            return;
          }

          let idx = -1;
          if (Array.isArray(items)) idx = items.indexOf(this);

          let item = Array.isArray(items) ? items[idx] : items;
          let summary = Array.isArray(summaries) ? summaries[idx] : summaries;
          let content = Array.isArray(contents) ? contents[idx] : contents;

          if (!item || !summary || !content) return;

          accordionEl.toggleOpen({
            willOpen: shouldOpen,
            item,
            summary,
            content,
          });
        };

        updateOpen(mqlTablet.matches);
        mqlTablet.onchange = (event) => updateOpen(event.matches);
      }
    },
    { extends: "details" }
  );
}
