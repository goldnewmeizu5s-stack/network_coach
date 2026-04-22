import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Auto-recovery for stale chunk URLs after a deploy. A dynamic import
// that hits the SPA fallback returns HTML and blows up at module parse
// time; catch it once, purge caches + SW, and reload on a fresh URL.
const RECOVERY_KEY = "__chunk_recovery_at";
function looksLikeChunkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("error loading dynamically imported module") ||
    m.includes("importing a module script failed") ||
    m.includes("importing module script failed") ||
    m.includes("unexpected token '<'") ||
    m.includes("expected a javascript module script") ||
    m.includes("mime type ('text/html')") ||
    m.includes("loading chunk") ||
    m.includes("loading css chunk")
  );
}

async function tryAutoRecover(message: string): Promise<void> {
  if (!looksLikeChunkError(message)) return;
  const last = Number(sessionStorage.getItem(RECOVERY_KEY) || "0");
  if (Date.now() - last < 15000) return; // avoid reload loops
  sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
  window.location.replace("/?v=" + Date.now());
}

window.addEventListener("error", (e) => {
  void tryAutoRecover(String(e?.message || ""));
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = (e?.reason as { message?: string } | null)?.message ?? "";
  void tryAutoRecover(String(reason));
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
