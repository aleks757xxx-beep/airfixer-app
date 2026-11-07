import { NAV, useRoute, type Route } from "./router";
import { ThemeToggle } from "./components/ThemeToggle";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StatusPage } from "./features/status/StatusPage";
import { Placeholder } from "./features/Placeholder";
import { useLogout } from "./api/auth";

function Screen({ route }: { route: Route }) {
  switch (route) {
    case "calendar":
      return <Placeholder title="Календарь" text="Шаг 3: календарь в стиле Buffer с перетаскиванием роликов." />;
    case "library":
      return <Placeholder title="Библиотека" text="Шаг 2: ролики из папки «Готовое»." />;
    case "posts":
      return <Placeholder title="Посты" text="Шаг 4: что запланировано, что вышло, ошибки." />;
    case "status":
      return <StatusPage />;
  }
}

export function App() {
  const route = useRoute();
  const logout = useLogout();
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-ink-deep/85">
        <span className="text-lg font-bold">🍁 PostFixer</span>
        <nav className="ml-6 hidden gap-1 md:flex" aria-label="Разделы">
          {NAV.map((n) => (
            <a
              key={n.route}
              href={`#/${n.route}`}
              aria-current={route === n.route ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                route === n.route ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10"
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/10"
          >
            Выйти
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <ErrorBoundary key={route}>
          <Screen route={route} />
        </ErrorBoundary>
      </main>

      {/* Нижнее меню на телефоне */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-white/10 dark:bg-ink-deep"
      >
        {NAV.map((n) => (
          <a
            key={n.route}
            href={`#/${n.route}`}
            aria-current={route === n.route ? "page" : undefined}
            className={`flex flex-col items-center py-2 text-xs ${route === n.route ? "text-brand" : "text-slate-500 dark:text-white/60"}`}
          >
            <span className="text-lg" aria-hidden>
              {n.icon}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
