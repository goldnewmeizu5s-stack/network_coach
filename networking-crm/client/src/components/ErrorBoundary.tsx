import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

// A failed dynamic import (stale chunk URL after a deploy) reports
// different messages across engines; treat them all as chunk errors so
// the user is offered "Reload" + we purge caches under the hood.
function looksLikeChunkError(error: Error): boolean {
  if (error.name === "ChunkLoadError" || error.name === "TypeError") {
    // TypeError alone is too broad; only fold in when the message hints.
  }
  const msg = (error.message || "").toLowerCase();
  const patterns = [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "loading chunk",
    "loading css chunk",
    "importing a module script failed",
    "importing module script failed",
    "unexpected token '<'", // HTML body parsed as JS (SPA fallback poison)
    "expected a javascript module script",
    "expected a javascript-or-wasm module script",
    "mime type ('text/html')",
  ];
  return (
    error.name === "ChunkLoadError" || patterns.some((p) => msg.includes(p))
  );
}

async function purgeCachesAndSw() {
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
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, isChunkError: looksLikeChunkError(error) };
  }

  handleRetry = async () => {
    if (this.state.isChunkError) {
      await purgeCachesAndSw();
      // Cache-buster: our old index.html might still be in the HTTP
      // cache (served with max-age before the fix). A fresh URL avoids
      // it entirely.
      window.location.replace("/?v=" + Date.now());
    } else {
      this.setState({ hasError: false, isChunkError: false });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="text-4xl">
            {this.state.isChunkError ? "\u{1F4E1}" : "\u{26A0}️"}
          </span>
          <p className="text-sm text-neutral-400">
            {this.state.isChunkError
              ? "Новая версия приложения. Обнови страницу."
              : "Что-то пошло не так."}
          </p>
          <button
            onClick={this.handleRetry}
            className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white active:bg-accent-hover"
          >
            {this.state.isChunkError ? "Обновить" : "Попробовать снова"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
