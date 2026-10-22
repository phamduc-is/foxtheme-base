import { QRCode } from "@theme/qr-code-generator";
/**
 * A custom element that displays a QR code image.
 *
 * @extends {HTMLElement}
 */
/**
 * @capability Declarative QR code — renders a QR code image for any string (URL, gift card code) into the element on connect, sized via width/height attributes; no network requests, generated client-side.
 * @when Anywhere a scannable code is needed from markup alone: gift card pages, "open on phone" links. Reuse instead of importing the generator library directly.
 * @contract <qr-code-image data-identifier="<text to encode>" [width] [height] [alt]>; the canvas/img is injected as a child by the QRCode library from @theme/qr-code-generator.
 * @keywords qr code, gift card code, scannable code, barcode, encode url, qr image, client-side qr
 */
class QRCodeImage extends HTMLElement {
  /** @type {number} */
  #width = 72;
  /** @type {number} */
  #height = 72;
  /** @type {string} */
  #alt = "";

  connectedCallback() {
    const widthAttribute = this.getAttribute("width") ?? "";
    this.#width = isNaN(parseInt(widthAttribute)) ? this.#width : parseInt(widthAttribute);
    const heightAttribute = this.getAttribute("height") ?? "";
    this.#height = isNaN(parseInt(heightAttribute)) ? this.#height : parseInt(heightAttribute);
    this.#alt = this.getAttribute("alt") ?? this.#alt;

    new QRCode(this, {
      text: this.getAttribute("data-identifier") || "",
      width: this.#width,
      height: this.#height,
      alt: this.#alt,
    });
  }
}

if (!customElements.get("qr-code-image")) {
  customElements.define("qr-code-image", QRCodeImage);
}
