import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Если экран упал — показываем понятное сообщение и кнопку, а не белый лист. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-lg font-bold">Что-то пошло не так</p>
        <p className="mt-2 text-sm text-on-surface-variant">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-4 rounded-full bg-tg px-5 py-2.5 font-semibold text-white"
          onClick={() => window.location.reload()}
        >
          Обновить страницу
        </button>
      </div>
    );
  }
}
