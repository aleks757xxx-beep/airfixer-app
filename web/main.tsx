import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { meKey } from "./api/auth";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthGate } from "./features/auth/AuthGate";
import "./styles.css";
import { ApiRequestError } from "./api/client";

const queryClient: QueryClient = new QueryClient({
  // Вход истёк (401) — заново спросить состояние входа, AuthGate покажет экран входа
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (err instanceof ApiRequestError && err.status === 401 && query.queryKey[0] !== meKey[0]) {
        void queryClient.invalidateQueries({ queryKey: meKey });
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      // 401 «Нужно войти» не повторяем — сразу показываем вход
      retry: (count, err) => !(err instanceof ApiRequestError && err.status === 401) && count < 1,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Нет #root");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <App />
        </AuthGate>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
