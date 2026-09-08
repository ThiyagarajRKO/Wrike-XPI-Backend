/* Thin wrapper over the CDN-loaded Toastify global (see
   frontend/admin-dashboard.html). The single toast entry point for every
   admin screen. */

export type ToastType = "success" | "error" | "info" | "warning";

const PALETTES: Record<ToastType, string> = {
  success: "linear-gradient(135deg, #0ecb81, #3fb950)",
  error: "linear-gradient(135deg, #f85149, #d03030)",
  info: "linear-gradient(135deg, #2f81f7, #6e40c9)",
  warning: "linear-gradient(135deg, #d29922, #e89e1d)",
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: "fa-circle-check",
  error: "fa-circle-xmark",
  info: "fa-circle-info",
  warning: "fa-triangle-exclamation",
};

export function toast(msg: string, type: ToastType = "info") {
  const Toastify = window.Toastify;
  if (!Toastify) return;

  const iconCls = TOAST_ICONS[type] || TOAST_ICONS.info;

  // Built as DOM nodes, not an HTML string: the message is arbitrary text
  // (often a server error), and textContent makes it structurally impossible
  // for it to be parsed as markup.
  const body = document.createElement("div");
  body.style.cssText = "display:flex;align-items:center;gap:10px";

  const icon = document.createElement("i");
  icon.className = `fa-solid ${iconCls}`;
  icon.style.cssText = "flex:none;color:#fff;font-size:15px";

  const label = document.createElement("span");
  label.style.flex = "1";
  label.textContent = msg;

  body.append(icon, label);

  const toastInstance = Toastify({
    text: "",
    duration: 4500,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: {
      background: PALETTES[type] || PALETTES.info,
      borderRadius: "8px",
      fontFamily: "'Inter', sans-serif",
      fontSize: "13.5px",
      padding: "12px 18px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      minWidth: "260px",
    },
  }).showToast();

  // This Toastify build ignores escapeHTML:false, so the body is attached to
  // the toast node after showToast() rather than passed as `text`.
  if (toastInstance?.toastElement) {
    toastInstance.toastElement.replaceChildren(body);
  }
}

/**
 * Destructive confirmation. Resolves true when the user goes ahead. Without
 * SweetAlert2 loaded this falls back to the native confirm() rather than
 * silently proceeding — a delete must never happen unasked.
 */
export async function confirmDanger(options: {
  title: string;
  html?: string;
  confirmText?: string;
}): Promise<boolean> {
  const Swal = window.Swal;

  if (!Swal) {
    return window.confirm(
      `${options.title}\n\n${(options.html || "").replace(/<[^>]*>/g, "")}`,
    );
  }

  const result = await Swal.fire({
    title: options.title,
    html: options.html,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: options.confirmText || "Delete",
    cancelButtonText: "Cancel",
    focusConfirm: false,
    reverseButtons: true,
    customClass: {
      confirmButton: "swal2-confirm swal2-danger",
      cancelButton: "swal2-cancel",
    },
  });

  return !!result.isConfirmed;
}

export function escHtml(str: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/** Thin wrapper over the CDN-loaded NProgress global — same top-of-page bar
    every other write action in the console already shows. */
export const progress = {
  start: () => window.NProgress?.start(),
  done: () => window.NProgress?.done(),
};
