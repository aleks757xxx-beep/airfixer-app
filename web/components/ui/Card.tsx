import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-m3m bg-surface-container p-4">
      {title ? <h2 className="mb-3 font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-container-highest ${className}`} />;
}
