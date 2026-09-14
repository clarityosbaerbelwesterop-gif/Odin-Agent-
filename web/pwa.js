if (
  "serviceWorker" in navigator &&
  (window.location.protocol === "https:" || window.location.hostname === "localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // Installation is optional; the hosted product remains fully usable without a service worker.
    });
  });
}
