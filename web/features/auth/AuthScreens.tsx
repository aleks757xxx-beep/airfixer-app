import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useLogin, usePasskeyLogin, useTotpSetup, useTotpVerify } from "../../api/auth";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-ink-card">
        <h1 className="text-2xl font-extrabold">🍁 {title}</h1>
        <p className="mb-5 mt-1 font-semibold text-brand dark:text-brand-light">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-brand dark:border-white/15 dark:bg-ink-deep";
const btnCls = "mt-3 w-full rounded-full bg-tg px-4 py-3.5 font-bold text-white disabled:opacity-60";

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mb-3 font-semibold text-red-500">
      {text}
    </p>
  ) : null;
}

export function LoginPage() {
  const [password, setPassword] = useState("");
  const login = useLogin();
  const passkey = usePasskeyLogin();
  const canPasskey = browserSupportsWebAuthn();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ password });
  };
  return (
    <Shell title="PostFixer" subtitle="Постинг для AirFixer">
      {canPasskey ? (
        <>
          <ErrorText text={passkey.error && passkey.error.message !== "Отменено" ? passkey.error.message : null} />
          <button type="button" className={`${btnCls} mt-0 bg-brand`} disabled={passkey.isPending} onClick={() => passkey.mutate()}>
            {passkey.isPending ? "Жду Face ID…" : "Войти по Face ID / Touch ID"}
          </button>
          <p className="my-4 text-center text-sm text-slate-500 dark:text-white/50">или паролем</p>
        </>
      ) : null}
      <form onSubmit={submit}>
        <ErrorText text={login.error?.message ?? null} />
        {/* Логин для «Паролей» Apple: чтобы связка ключей сохранила и подставляла пароль и код */}
        <input type="text" name="username" autoComplete="username" value="postfixer" readOnly hidden />
        <input
          className={inputCls}
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!canPasskey}
          required
        />
        <button className={btnCls} type="submit" disabled={login.isPending}>
          {login.isPending ? "Проверяю…" : "Войти"}
        </button>
      </form>
    </Shell>
  );
}

function CodeForm({ submitLabel }: { submitLabel: string }) {
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const verify = useTotpVerify();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate({ code, trustDevice: trust });
  };
  return (
    <form onSubmit={submit}>
      <ErrorText text={verify.error?.message ?? null} />
      <input
        className={`${inputCls} text-center text-2xl tracking-[0.4em]`}
        inputMode="numeric"
        name="otp"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="••••••"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        autoFocus
        required
      />
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="size-4" />
        Запомнить это устройство
      </label>
      <button className={btnCls} type="submit" disabled={verify.isPending || code.length !== 6}>
        {verify.isPending ? "Проверяю…" : submitLabel}
      </button>
    </form>
  );
}

export function TotpVerifyPage() {
  return (
    <Shell title="Код проверки" subtitle="6 цифр из «Паролей» Apple">
      <CodeForm submitLabel="Подтвердить" />
    </Shell>
  );
}

export function TotpSetupPage() {
  const setup = useTotpSetup(true);
  const [qr, setQr] = useState<string | null>(null);
  const uri = setup.data?.uri;

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    QRCode.toDataURL(uri, { margin: 1, width: 240 })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [uri]);

  return (
    <Shell title="Защита входа" subtitle="Подключите код проверки в «Паролях» Apple">
      {setup.isPending ? <div className="mx-auto size-60 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10" /> : null}
      <ErrorText text={setup.error?.message ?? null} />
      {setup.data ? (
        <>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
            <li>
              <b>На iPhone:</b> нажмите кнопку ниже → выберите «Пароли» → запись PostFixer (или новую).
            </li>
            <li>
              <b>На Mac:</b> откройте «Пароли» → запись PostFixer → «Изменить» → «Настроить код проверки» → «Ввести ключ настройки» и вставьте ключ ниже (или отсканируйте QR с iPhone).
            </li>
            <li>Введите 6 цифр, которые покажут «Пароли». Дальше Safari будет подставлять код сам.</li>
          </ol>
          <a href={setup.data.uri} className="mb-4 block rounded-full border border-brand px-4 py-2.5 text-center font-semibold text-brand md:hidden">
            Добавить код в «Пароли»
          </a>
          {qr ? <img src={qr} alt="QR-код для кода проверки" className="mx-auto mb-3 hidden size-60 rounded-xl bg-white p-2 md:block" /> : null}
          <p className="mb-4 break-all text-center font-mono text-xs text-slate-500 dark:text-white/60">
            Ключ вручную: {setup.data.secret}
          </p>
          <CodeForm submitLabel="Подключить" />
        </>
      ) : null}
    </Shell>
  );
}
