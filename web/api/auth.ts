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
import { apiGet, apiPost } from "./client";

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
