import type { ReactNode } from "react";
import { useMe } from "../../api/auth";
import { LoginPage, TotpSetupPage, TotpVerifyPage } from "./AuthScreens";

/** Пускает в приложение только после пароля и кода. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return <div className="flex min-h-dvh items-center justify-center text-on-surface-variant">Загрузка…</div>;
  }
  if (me.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="font-semibold">{me.error.message}</p>
        <button type="button" className="rounded-full bg-tg px-5 py-2.5 font-semibold text-white" onClick={() => void me.refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  switch (me.data.state) {
    case "anonymous":
      return <LoginPage />;
    case "mfa_setup":
      return <TotpSetupPage />;
    case "mfa_required":
      return <TotpVerifyPage />;
    case "ok":
      return <>{children}</>;
  }
}
