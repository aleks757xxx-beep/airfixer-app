import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LoginInputSchema,
  MeSchema,
  OkSchema,
  TotpCodeSchema,
  TotpSetupSchema,
  type LoginInput,
  type Me,
  type TotpCodeInput,
  type TotpSetup,
} from "../../shared/schemas";
import { z } from "zod";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiDelete, apiGet, apiPost } from "./client";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery<Me>({ queryKey: meKey, queryFn: () => apiGet("/auth/me", MeSchema), staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => apiPost("/auth/login", MeSchema, LoginInputSchema.parse(input)),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useTotpSetup(enabled: boolean) {
  return useQuery<TotpSetup>({
    queryKey: ["totp-setup"],
    queryFn: () => apiPost("/auth/totp/setup", TotpSetupSchema),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export function useTotpVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TotpCodeInput) => apiPost("/auth/totp/verify", MeSchema, TotpCodeSchema.parse(input)),
    onSuccess: (me) => {
      qc.removeQueries({ queryKey: ["totp-setup"] });
      qc.setQueryData(meKey, me);
    },
  });
}

export function useLogout(all = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(all ? "/auth/logout-all" : "/auth/logout", OkSchema),
    onSuccess: () => {
      qc.setQueryData(meKey, { state: "anonymous" } satisfies Me);
      // убрать данные прошлой сессии, но не сам запрос «кто я» (на нём держится экран входа)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
    },
  });
}

// ---- Вход по Face ID / Touch ID (ключи входа) ----
const StartSchema = z.object({ challengeId: z.string(), options: z.record(z.string(), z.unknown()) });
const PasskeyListSchema = z.object({
  items: z.array(z.object({ id: z.string(), device: z.string(), createdAt: z.number(), lastUsedAt: z.number().nullable() })),
});
const passkeysKey = ["passkeys"] as const;

/** Отмена системного окна Face ID — не ошибка. */
function friendly(e: unknown): Error {
  if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) return new Error("Отменено");
  if (e instanceof Error && e.name === "InvalidStateError") return new Error("На этом устройстве ключ входа уже есть");
  return e instanceof Error ? e : new Error("Не получилось");
}

export function usePasskeyLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = await apiPost("/auth/passkey/login/options", StartSchema);
      let response: unknown;
      try {
        response = await startAuthentication({ optionsJSON: start.options as unknown as PublicKeyCredentialRequestOptionsJSON });
      } catch (e: unknown) {
        throw friendly(e);
      }
      return apiPost("/auth/passkey/login/verify", MeSchema, { challengeId: start.challengeId, response });
    },
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function usePasskeys() {
  return useQuery({ queryKey: passkeysKey, queryFn: () => apiGet("/auth/passkey", PasskeyListSchema) });
}

export function usePasskeyRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = await apiPost("/auth/passkey/register/options", StartSchema);
      let response: unknown;
      try {
        response = await startRegistration({ optionsJSON: start.options as unknown as PublicKeyCredentialCreationOptionsJSON });
      } catch (e: unknown) {
        throw friendly(e);
      }
      return apiPost("/auth/passkey/register/verify", OkSchema, { challengeId: start.challengeId, response });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: passkeysKey }),
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/auth/passkey/${encodeURIComponent(id)}`, OkSchema),
    onSettled: () => void qc.invalidateQueries({ queryKey: passkeysKey }),
  });
}
