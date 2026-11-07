import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsSchema, type Settings, type SettingsInput } from "../../shared/schemas";
import { apiGet, apiPut } from "./client";

export const settingsKey = ["settings"] as const;

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
