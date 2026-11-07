import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-ink-card">
      {title ? <h2 className="mb-3 font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-white/10 ${className}`} />;
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 rounded-full ${ok ? "bg-wa" : "bg-red-500"}`}
    />
  );
}
