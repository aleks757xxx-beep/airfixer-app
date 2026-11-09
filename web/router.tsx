import { useEffect, useState } from "react";
import type { IconName } from "./components/m3/icons";

/** Простой роутер по #/путь — без лишних библиотек. */
export type Route = "calendar" | "library" | "posts" | "stats" | "connections" | "settings" | "rules";

const ROUTES: ReadonlyArray<Route> = ["calendar", "library", "posts", "stats", "connections", "settings", "rules"];

function parse(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  // старый адрес «Состояние»: возврат после подключения соцсети → «Подключения», остальное → «Настройки»
  if (path === "status") return /connect/.test(query) ? "connections" : "settings";
  return (ROUTES as ReadonlyArray<string>).includes(path) ? (path as Route) : "calendar";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Разделы в меню (нижняя панель на телефоне, боковая — на компьютере). */
export const NAV: ReadonlyArray<{ route: Route; label: string; icon: IconName }> = [
  { route: "calendar", label: "Календарь", icon: "calendar_month" },
  { route: "library", label: "Библиотека", icon: "video_library" },
  { route: "posts", label: "Посты", icon: "article" },
  { route: "stats", label: "Статистика", icon: "bar_chart" },
  { route: "connections", label: "Подключения", icon: "hub" },
];

export const TITLES: Record<Route, string> = {
  calendar: "Календарь",
  library: "Библиотека",
  posts: "Посты",
  stats: "Статистика",
  connections: "Подключения",
  settings: "Настройки",
  rules: "Правила публикации",
};
