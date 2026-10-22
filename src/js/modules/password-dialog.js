import { DialogComponent } from "@theme/dialog";

/**
 * A custom element that manages password entry dialog.
 * Auto-opens when form has errors after page reload.
 *
 * @extends {DialogComponent}
 */
/**
 * @capability Storefront password-page dialog that re-opens itself after a full-page reload when the submitted password was wrong, so the error message is visible without another click.
 * @when The password.liquid template's "enter using password" modal. Reuse the pattern (attribute flag → auto showDialog on connect) for any dialog that must survive a form-error reload.
 * @contract <password-dialog-component [data-has-errors]> extending DialogComponent (standard dialog markup); presence of data-has-errors triggers showDialog() on connect.
 * @keywords password page, storefront password, auto open dialog on error, form error reopen, locked store, password modal
 */
export class PasswordDialogComponent extends DialogComponent {
  connectedCallback() {
    super.connectedCallback();

    // Auto-open dialog if there are form errors
    if (this.hasAttribute("data-has-errors")) {
      this.showDialog();
    }
  }
}

if (!customElements.get("password-dialog-component"))
  customElements.define("password-dialog-component", PasswordDialogComponent);
