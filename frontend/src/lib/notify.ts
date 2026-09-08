/* Thin wrappers over the CDN-loaded Toastify / SweetAlert2 / NProgress globals
   (see frontend/admin-dashboard.html). Extracted so screens beyond the
   original dashboard can raise the same notifications without each one
   re-declaring the palette and Swal button classes. Every wrapper degrades to
   a no-op or a sensible default if the global is absent, so a page still works
   when a CDN is blocked. */

const PALETTES: Record<string, string> = {
  success: "linear-gradient(135deg, #0ecb81, #3fb950)",
  error: "linear-gradient(135deg, #f85149, #d03030)",
  info: "linear-gradient(135deg, #2f81f7, #6e40c9)",
  warning: "linear-gradient(135deg, #d29922, #e89e1d)",
};

export type ToastType = "success" | "error" | "info" | "warning";

export function toast(msg: string, type: ToastType = "info") {
  const Toastify = window.Toastify;
  if (!Toastify) return;

  Toastify({
    text: msg,
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
}

export function escHtml(str: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/**
 * Destructive confirmation. Resolves true when the user goes ahead.
 * Without SweetAlert2 loaded this falls back to the native confirm() rather
 * than silently proceeding — a delete must never happen unasked.
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

export const progress = {
  start: () => window.NProgress?.start(),
  done: () => window.NProgress?.done(),
};
