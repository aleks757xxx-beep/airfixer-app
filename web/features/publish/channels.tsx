import type { Channel } from "../../../shared/schemas";

const SERVICE: Readonly<Record<string, { short: string; cls: string; label: string }>> = {
  instagram: { short: "IG", cls: "bg-gradient-to-br from-fuchsia-500 to-amber-400", label: "Instagram" },
  facebook: { short: "FB", cls: "bg-[#1877f2]", label: "Facebook" },
  tiktok: { short: "TT", cls: "bg-black ring-1 ring-white/30", label: "TikTok" },
  youtube: { short: "YT", cls: "bg-[#ff0000]", label: "YouTube" },
  googlebusiness: { short: "G", cls: "bg-[#34a853]", label: "Google" },
  telegram: { short: "TG", cls: "bg-[#229ed9]", label: "Telegram" },
  threads: { short: "@", cls: "bg-black ring-1 ring-white/30", label: "Threads" },
};
export const serviceInfo = (s: string) => SERVICE[s] ?? { short: s.slice(0, 2).toUpperCase(), cls: "bg-white/20", label: s };

/** Значок соцсети (без внешних картинок — строгий CSP). */
export function ServiceBadge({ service, size = "sm" }: { service: string; size?: "sm" | "md" }) {
  const i = serviceInfo(service);
  const dim = size === "md" ? "h-7 w-7 text-[11px]" : "h-5 w-5 text-[9px]";
  return (
    <span aria-label={i.label} className={`inline-flex shrink-0 items-center justify-center rounded-full font-black text-white ${dim} ${i.cls}`}>
      {i.short}
    </span>
  );
}

export const channelLabel = (c: Channel) => c.displayName || c.name;
