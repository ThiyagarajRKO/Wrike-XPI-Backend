/* Thin wrapper over the CDN-loaded Toastify global (see
   frontend/admin-dashboard.html) for screens outside AdminDashboard.tsx,
   which keeps its own copy of this to stay byte-identical to the original
   migration. Mirrors that copy's palette/styling exactly so a toast looks
   the same regardless of which screen raised it. */

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
  const toastBody =
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<i class="fa-solid ' +
    iconCls +
    '" style="flex:none;color:#fff;font-size:15px"></i>' +
    '<span style="flex:1">' +
    escHtml(msg) +
    "</span>" +
    "</div>";

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
  // This Toastify build does not honour escapeHTML:false, so the icon/message
  // markup is injected straight into the toast node after showToast().
  if (toastInstance?.toastElement) {
    toastInstance.toastElement.innerHTML = toastBody;
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
