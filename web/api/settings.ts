import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OkSchema, SettingsSchema, type Settings, type SettingsInput } from "../../shared/schemas";
import { apiGet, apiPost, apiPut } from "./client";

const settingsKey = ["settings"] as const;

export function useSettings() {
  return useQuery<Settings>({ queryKey: settingsKey, queryFn: () => apiGet("/settings", SettingsSchema), staleTime: 5 * 60_000 });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: SettingsInput) => apiPut("/settings", SettingsSchema, s),
    onSuccess: (data) => qc.setQueryData(settingsKey, data),
  });
}

/** Какие уведомления в Telegram выключены. */
export function useSaveNotify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { off?: string[]; chatId?: string }) => apiPut("/settings/notify", OkSchema, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey }),
  });
}
export function useTestNotify() {
  return useMutation({ mutationFn: () => apiPost("/settings/notify/test", OkSchema, {}) });
}
