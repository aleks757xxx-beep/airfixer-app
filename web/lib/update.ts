import { useEffect, useState } from "react";

/**
 * Новая версия PostFixer: сравниваем файл приложения на сервере (index.html → /assets/index-*.js)
 * с тем, что загружено сейчас. Проверка — раз в 3 минуты и когда приложение снова открыли.
 */
const currentScript = (): string | null => {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
};

async function serverScript(): Promise<string | null> {
  try {
    const res = await fetch("/", { cache: "no-store", credentials: "same-origin" });
    const html = await res.text();
    const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/);
    return m?.[1] ? new URL(m[1], location.href).pathname : null;
  } catch {
    return null;
  }
}

export function useNewVersion(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const mine = currentScript();
    if (!mine) return; // локальная разработка
    let alive = true;
    const check = async () => {
      const s = await serverScript();
      if (alive && s && s !== mine) setAvailable(true);
    };
    const onVisible = () => document.visibilityState === "visible" && void check();
    const t = window.setInterval(() => void check(), 3 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return available;
}

export const reloadApp = () => window.location.reload();
