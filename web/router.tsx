import { useEffect, useState } from "react";

/** Простой роутер по #/путь — без лишних библиотек. */
export type Route = "calendar" | "library" | "posts" | "stats" | "status";

const ROUTES: ReadonlyArray<Route> = ["calendar", "library", "posts", "stats", "status"];

function parse(hash: string): Route {
  const r = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return (ROUTES as ReadonlyArray<string>).includes(r) ? (r as Route) : "calendar";
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

export const NAV: ReadonlyArray<{ route: Route; label: string; icon: string }> = [
  { route: "calendar", label: "Календарь", icon: "📅" },
  { route: "library", label: "Библиотека", icon: "🎬" },
  { route: "posts", label: "Посты", icon: "📋" },
  { route: "stats", label: "Статистика", icon: "📈" },
  { route: "status", label: "Состояние", icon: "⚙️" },
];
