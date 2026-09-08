// Ambient typings for the CDN-loaded libraries the dashboard page still uses
// exactly as the original EJS did (jQuery, DataTables, SweetAlert2, Toastify,
// NProgress) - loaded via <script> tags in portal-dashboard.html, not npm
// packages. Loosely typed on purpose: these are third-party globals we don't
// own, not app code.
interface Window {
  jQuery: any;
  $: any;
  Swal: any;
  Toastify: any;
  NProgress: any;
}
