import { Component } from "@theme/component";
import { inView } from "@theme/animation";

class QuickComparisonTable extends Component {
  #inViewStop = null;

  connectedCallback() {
    super.connectedCallback();

    this.#inViewStop = inView(this, () => this.#init(), { margin: "0px 0px 400px 0px" });
  }

  disconnectedCallback() {
    this.#inViewStop?.();
    this.#inViewStop = null;

    super.disconnectedCallback();
  }

  #init() {
    fetch(this.dataset.url)
      .then((response) => response.text())
      .then((responseText) => {
        const sectionInnerHTML = new DOMParser()
          .parseFromString(responseText, "text/html")
          .querySelector(".shopify-section");

        if (sectionInnerHTML === null) return;

        const recommendations = sectionInnerHTML.querySelector("quick-comparison-table");
        if (recommendations && recommendations.innerHTML.trim().length) {
          this.innerHTML = recommendations.innerHTML;
        }

        if (recommendations.querySelector("[data-quick-compare-table]")) {
          this.dispatchEvent(new CustomEvent("quick-comparison-table:loaded"));
        } else {
          this.closest(".shopify-section").remove();
          this.dispatchEvent(new CustomEvent("quick-comparison-table:empty"));
        }
      })
      .catch((e) => {
        console.error(e);
      });
  }
}

if (!customElements.get("quick-comparison-table")) {
  customElements.define("quick-comparison-table", QuickComparisonTable);
}
