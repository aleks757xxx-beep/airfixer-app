import { NAV, TITLES, useRoute, type Route } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { SettingsPage } from "./features/status/StatusPage";
import { LibraryPage } from "./features/library/LibraryPage";
import { CalendarPage } from "./features/publish/CalendarPage";
import { PostsPage } from "./features/publish/PostsPage";
import { StatsPage } from "./features/publish/StatsPage";
import { ClaudeToast, useAskClaude } from "./features/claude/askClaude";
import { Icon } from "./components/m3";
import { ICONS, type IconName } from "./components/m3/icons";

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
    case "connections":
      return <ConnectionsPage />;
    case "settings":
      return <SettingsPage />;
  }
}

/** Значок раздела: у выбранного — закрашенный (как в M3). */
function navIcon(icon: IconName, active: boolean): IconName {
  const fill = `${icon}_fill`;
  return active && fill in ICONS ? (fill as IconName) : icon;
}

function NavItem({ route, label, icon, active, rail }: { route: Route; label: string; icon: IconName; active: boolean; rail: boolean }) {
  return (
    <a
      href={`#/${route}`}
      aria-current={active ? "page" : undefined}
      className={`group flex flex-col items-center gap-1 ${rail ? "w-20 py-1" : "min-w-0 flex-1 pb-4 pt-3"} text-[11px] leading-4 font-medium tracking-tight ${active ? "text-on-surface" : "text-on-surface-variant"}`}
    >
      <span
        className={`state-layer flex h-8 w-14 items-center justify-center rounded-full ${active ? "bg-secondary-container text-on-secondary-container" : ""}`}
      >
        <Icon name={navIcon(icon, active)} />
      </span>
      <span className={`max-w-full truncate px-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </a>
  );
}

export function App() {
  const route = useRoute();
  const ask = useAskClaude();
  const wide = route === "calendar";
  return (
    <div className="min-h-dvh bg-surface pb-20 md:pb-0 md:pl-20">
      {/* Боковая панель (Navigation rail) — компьютер */}
      <nav aria-label="Разделы" className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center gap-3 bg-surface pt-4 md:flex">
        <a href="#/calendar" aria-label="PostFixer" className="mb-4 flex size-14 items-center justify-center rounded-m3l bg-primary-container text-2xl">
          🍁
        </a>
        {NAV.map((n) => (
          <NavItem key={n.route} {...n} active={route === n.route} rail />
        ))}
        <div className="mt-auto mb-4">
          <NavItem route="settings" label="Настройки" icon="settings" active={route === "settings"} rail />
        </div>
      </nav>

      {/* Верхняя панель (Top app bar) */}
      <header className="sticky top-0 z-10 flex h-16 items-center gap-1 bg-surface/95 px-2 backdrop-blur md:px-6">
        <span className="ml-2 text-xl md:hidden" aria-hidden>
          🍁
        </span>
        <h1 className="type-title-l ml-3 text-on-surface md:ml-0">{TITLES[route]}</h1>
        <button
          type="button"
          onClick={() => ask()}
          className="state-layer type-label-l ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-primary-container pl-4 pr-5 text-on-primary-container"
        >
          <Icon name="chat" size={18} />
          Claude
        </button>
        <a
          href="#/settings"
          aria-label="Настройки"
          title="Настройки"
          className="state-layer inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant md:hidden"
        >
          <Icon name={route === "settings" ? "settings_fill" : "settings"} />
        </a>
      </header>
      <ClaudeToast />

      <main className={`mx-auto px-4 pb-6 md:px-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
        <ErrorBoundary key={route}>
          <Screen route={route} />
        </ErrorBoundary>
      </main>

      {/* Нижняя панель (Navigation bar) — телефон */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-20 flex bg-surface-container pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map((n) => (
          <NavItem key={n.route} {...n} active={route === n.route} rail={false} />
        ))}
      </nav>
    </div>
  );
}
