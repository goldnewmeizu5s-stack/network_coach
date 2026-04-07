import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    const isChunkError =
      error.name === "ChunkLoadError" ||
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Loading chunk") ||
      error.message.includes("Loading CSS chunk");

    return { hasError: true, isChunkError };
  }

  handleRetry = () => {
    if (this.state.isChunkError) {
      window.location.reload();
    } else {
      this.setState({ hasError: false, isChunkError: false });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="text-4xl">
            {this.state.isChunkError ? "\u{1F4E1}" : "\u{26A0}\uFE0F"}
          </span>
          <p className="text-sm text-neutral-400">
            {this.state.isChunkError
              ? "Не удалось загрузить страницу. Проверь интернет."
              : "Что-то пошло не так."}
          </p>
          <button
            onClick={this.handleRetry}
            className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white active:bg-accent-hover"
          >
            {this.state.isChunkError ? "Перезагрузить" : "Попробовать снова"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
