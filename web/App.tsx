import { NAV, TITLES, useRoute, type Route } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { SettingsPage } from "./features/status/StatusPage";
import { RulesPage } from "./features/rules/RulesArticle";
import { LibraryPage } from "./features/library/LibraryPage";
import { CalendarPage } from "./features/publish/CalendarPage";
import { PostsPage } from "./features/publish/PostsPage";
import { StatsPage } from "./features/publish/StatsPage";
import { ClaudeToast, useAskClaude } from "./features/claude/askClaude";
import { Icon, IconButton } from "./components/m3";
import { reloadApp, useNewVersion } from "./lib/update";
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
    case "rules":
      return <RulesPage />;
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
      <span className="max-w-full truncate">{label}</span>
    </a>
  );
}

export function App() {
  const route = useRoute();
  const ask = useAskClaude();
  const wide = route === "calendar";
  const newVersion = useNewVersion();
  return (
    <div className="min-h-dvh overflow-x-clip bg-surface pb-20 md:pb-0 md:pl-20">
      {/* Боковая панель (Navigation rail) — компьютер */}
      <nav aria-label="Разделы" className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center gap-3 bg-surface pt-4 md:flex">
        <a href="#/calendar" aria-label="PostFixer" className="mb-4 block size-14 overflow-hidden rounded-m3l">
          <img src="/logo-96.png" alt="" width={56} height={56} className="size-14" />
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
        <img src="/logo-96.png" alt="" aria-hidden width={32} height={32} className="ml-2 size-8 rounded-m3s md:hidden" />
        <h1 className="type-title-l ml-3 text-on-surface md:ml-0">{TITLES[route]}</h1>
        <IconButton icon="refresh" label="Обновить" className="ml-auto" onClick={reloadApp} />
        <button
          type="button"
          onClick={() => ask()}
          aria-label="Claude"
          className="state-layer type-label-l inline-flex h-10 items-center gap-2 rounded-full bg-primary-container px-3 text-on-primary-container sm:pl-4 sm:pr-5"
        >
          <Icon name="chat" size={18} />
          <span className="hidden sm:inline">Claude</span>
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
      {newVersion ? (
        <div
          role="status"
          className="elevation-3 fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-md items-center gap-3 rounded-m3s bg-inverse-surface py-2 pl-4 pr-2 text-inverse-on-surface md:bottom-6"
        >
          <span className="type-body-m flex-1">Вышла новая версия PostFixer</span>
          <button type="button" onClick={reloadApp} className="state-layer type-label-l h-10 rounded-full px-3 text-inverse-primary">
            Обновить
          </button>
        </div>
      ) : null}

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
