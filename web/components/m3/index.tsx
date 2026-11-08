import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ICONS, type IconName } from "./icons";

/** Небольшой набор компонентов Material Design 3 (без внешних библиотек). */

export function Icon({ name, size = 24, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 -960 960 960" width={size} height={size} aria-hidden className={`shrink-0 fill-current ${className}`}>
      <path d={ICONS[name]} />
    </svg>
  );
}

type Variant = "filled" | "tonal" | "outlined" | "text" | "error" | "danger" | "danger-outlined";
const VARIANT: Record<Variant, string> = {
  filled: "bg-primary text-on-primary hover:elevation-1",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "border border-outline text-primary",
  text: "text-primary px-3",
  error: "bg-error text-on-error",
  danger: "text-error px-3",
  "danger-outlined": "border border-error text-error",
};

/** Кнопка M3: высота 40, полностью скруглённая, подпись label-large. */
export function Button({
  variant = "filled",
  icon,
  children,
  className = "",
  ...rest
}: { variant?: Variant; icon?: IconName; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`state-layer type-label-l inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-6 py-2 text-center disabled:pointer-events-none disabled:opacity-40 ${icon ? "pl-4" : ""} ${VARIANT[variant]} ${className}`}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

/** Ссылка, оформленная как кнопка M3. */
export function LinkButton({
  variant = "filled",
  icon,
  href,
  children,
  className = "",
  external,
}: {
  variant?: Variant;
  icon?: IconName;
  href: string;
  children: ReactNode;
  className?: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`state-layer type-label-l inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 ${icon ? "pl-4" : ""} ${VARIANT[variant]} ${className}`}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </a>
  );
}

export function IconButton({ icon, label, className = "", ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={`state-layer inline-flex size-10 items-center justify-center rounded-full text-on-surface-variant ${className}`}>
      <Icon name={icon} />
    </button>
  );
}

/** Карточки M3: filled (контейнер выше), elevated, outlined. Скругление 12. */
export function M3Card({ variant = "filled", className = "", children }: { variant?: "filled" | "elevated" | "outlined"; className?: string; children: ReactNode }) {
  const v =
    variant === "elevated"
      ? "bg-surface-container-low elevation-1"
      : variant === "outlined"
        ? "border border-outline-variant bg-surface"
        : "bg-surface-container-highest";
  return <section className={`rounded-m3m ${v} ${className}`}>{children}</section>;
}

/** Чип-подсказка / ассистент (только отображение). */
export function Chip({ icon, children, tone = "default" }: { icon?: IconName; children: ReactNode; tone?: "default" | "success" | "warning" | "error" | "primary" }) {
  const t = {
    default: "border border-outline-variant text-on-surface-variant",
    success: "bg-success-container text-success",
    warning: "bg-warning-container text-warning",
    error: "bg-error-container text-on-error-container",
    primary: "bg-secondary-container text-on-secondary-container",
  }[tone];
  return (
    <span className={`type-label-l inline-flex h-8 items-center gap-1.5 rounded-m3s px-3 ${icon ? "pl-2" : ""} ${t}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </span>
  );
}

/** Строка списка M3: значок/аватар слева, заголовок и подпись, действие справа. */
export function ListItem({ leading, headline, supporting, trailing }: { leading?: ReactNode; headline: ReactNode; supporting?: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-4 py-2">
      {leading ? <div className="flex shrink-0 items-center text-on-surface-variant">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="type-body-l text-on-surface">{headline}</div>
        {supporting ? <div className="type-body-m text-on-surface-variant">{supporting}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

/** Заголовок раздела страницы. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center gap-2 first:mt-0">
      <h2 className="type-title-m text-on-surface">{children}</h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/** Диалог M3: скругление 28, контейнер high, затемнение фона. Закрывается по Esc и клику по фону. */
export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="elevation-3 w-full max-w-md rounded-m3xl bg-surface-container-high p-6">
        <h2 className="type-headline-s mb-4 text-on-surface">{title}</h2>
        <div className="type-body-m text-on-surface-variant">{children}</div>
        {actions ? <div className="mt-6 flex justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Поле ввода M3 (outlined): подпись над полем, рамка outline, фокус — primary. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "url" | "numeric";
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="type-body-s mb-1 block text-on-surface-variant">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        className="type-body-l h-14 w-full rounded-m3xs border border-outline bg-transparent px-4 text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:border-2 focus:border-primary"
      />
    </label>
  );
}

/** Сообщение-плашка: успех / ошибка / предупреждение / сведения. */
export function Banner({ tone, children }: { tone: "success" | "error" | "warning" | "info"; children: ReactNode }) {
  const t = {
    success: ["bg-success-container text-success", "check_circle"],
    error: ["bg-error-container text-on-error-container", "error"],
    warning: ["bg-warning-container text-warning", "warning"],
    info: ["bg-secondary-container text-on-secondary-container", "info"],
  } as const;
  const [cls, icon] = t[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`type-body-m flex items-start gap-3 rounded-m3m p-3 ${cls}`}>
      <Icon name={icon} size={20} className="mt-px" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
