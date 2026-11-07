import { NAV, useRoute, type Route } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StatusPage } from "./features/status/StatusPage";
import { LibraryPage } from "./features/library/LibraryPage";
import { CalendarPage } from "./features/publish/CalendarPage";
import { PostsPage } from "./features/publish/PostsPage";
import { StatsPage } from "./features/publish/StatsPage";
import { AskClaudeButton, ClaudeToast } from "./features/claude/askClaude";

function Screen({ route }: { route: Route }) {
  switch (route) {
    case "calendar":
      return <CalendarPage />;
    case "library":
      return <LibraryPage />;
    case "posts":
      return <PostsPage />;
    case "stats":
      return <StatsPage />;
    case "status":
      return <StatusPage />;
  }
}

export function App() {
  const route = useRoute();
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
        <AskClaudeButton className="ml-auto rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white" />
      </header>
      <ClaudeToast />

      <main className={`mx-auto p-4 ${route === "calendar" ? "max-w-7xl" : "max-w-5xl"}`}>
        <ErrorBoundary key={route}>
          <Screen route={route} />
        </ErrorBoundary>
      </main>

      {/* Нижнее меню на телефоне */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-white/10 dark:bg-ink-deep"
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
