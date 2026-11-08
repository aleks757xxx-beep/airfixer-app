import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BufferPostListSchema,
  ChannelListSchema,
  ComposeResultSchema,
  OkSchema,
  PostResultSchema,
  SnippetListSchema,
  SnippetResultSchema,
  StatsSchema,
  BufferLimitsSchema,
  DirectAccountsSchema,
  type BufferLimits,
  type DirectAccounts,
  type SnippetInput,
  type SnippetList,
  type Stats,
  type BufferPostList,
  type ChannelList,
  type ComposeInput,
} from "../../shared/schemas";
import { ApiRequestError, apiGet, apiPost, apiPut } from "./client";
import { ApiErrorSchema } from "../../shared/schemas";

const channelsKey = ["channels"] as const;
const postsKey = ["posts"] as const;

export function useChannels() {
  return useQuery<ChannelList>({ queryKey: channelsKey, queryFn: () => apiGet("/publish/channels", ChannelListSchema), staleTime: 10 * 60_000 });
}

export function usePosts(from: number, to: number) {
  return useQuery<BufferPostList>({
    queryKey: [...postsKey, from, to],
    queryFn: () => apiGet(`/publish/posts?from=${from}&to=${to}`, BufferPostListSchema),
    // У Buffer лимит запросов: обновляем не чаще раза в 2 минуты (сервер ещё и кэширует)
    staleTime: 120_000,
    refetchInterval: 10 * 60_000,
  });
}

export function useCompose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComposeInput) => apiPost("/publish/posts", ComposeResultSchema, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useMovePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dueAt }: { id: string; dueAt: number }) => apiPost(`/publish/posts/${encodeURIComponent(id)}/move`, PostResultSchema, { dueAt }),
    onSettled: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useEditPostText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; text: string; title?: { service: string; title: string }; firstComment?: string }) =>
      apiPost(`/publish/posts/${encodeURIComponent(id)}/text`, PostResultSchema, body),
    onSettled: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useShareNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/publish/posts/${encodeURIComponent(id)}/share-now`, PostResultSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v2/publish/posts/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok && OkSchema.safeParse(data).success) return;
      const err = ApiErrorSchema.safeParse(data);
      throw new ApiRequestError(err.success ? err.data.error : `Ошибка (${res.status})`, res.status);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useRetryPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/publish/posts/${encodeURIComponent(id)}/retry`, PostResultSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: postsKey }),
  });
}

export function useStats(from: number, to: number) {
  return useQuery<Stats>({
    queryKey: ["stats", from, to],
    queryFn: () => apiGet(`/publish/stats?from=${from}&to=${to}`, StatsSchema),
    staleTime: 15 * 60_000,
    retry: false,
  });
}

const snippetsKey = ["snippets"] as const;
export function useSnippets() {
  return useQuery<SnippetList>({ queryKey: snippetsKey, queryFn: () => apiGet("/publish/snippets", SnippetListSchema), staleTime: 10 * 60_000 });
}
export function useSaveSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: SnippetInput & { id?: string }) => {
      if (id) await apiPut(`/publish/snippets/${encodeURIComponent(id)}`, OkSchema, input);
      else await apiPost("/publish/snippets", SnippetResultSchema, input);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: snippetsKey }),
  });
}
export function useDeleteSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v2/publish/snippets/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok && OkSchema.safeParse(data).success) return;
      const err = ApiErrorSchema.safeParse(data);
      throw new ApiRequestError(err.success ? err.data.error : `Ошибка (${res.status})`, res.status);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: snippetsKey }),
  });
}

export function useBufferLimits() {
  return useQuery<BufferLimits>({ queryKey: ["buffer-limits"], queryFn: () => apiGet("/publish/limits", BufferLimitsSchema), staleTime: 10 * 60_000, retry: false });
}

const directKey = ["direct-accounts"] as const;
export function useDirectAccounts() {
  return useQuery<DirectAccounts>({ queryKey: directKey, queryFn: () => apiGet("/connect/accounts", DirectAccountsSchema), staleTime: 60_000 });
}
/** Telegram: подключить канал по адресу (@name) или найти, куда бота добавили админом. */
export function useConnectTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (address: string) => {
      const res = await fetch("/api/v2/connect/telegram", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data: unknown = await res.json().catch(() => null);
      const ok = z.object({ ok: z.literal(true), names: z.array(z.string()) }).safeParse(data);
      if (res.ok && ok.success) return ok.data.names;
      const err = ApiErrorSchema.safeParse(data);
      throw new ApiRequestError(err.success ? err.data.error : `Ошибка (${res.status})`, res.status);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: directKey });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v2/connect/accounts/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok && OkSchema.safeParse(data).success) return;
      const err = ApiErrorSchema.safeParse(data);
      throw new ApiRequestError(err.success ? err.data.error : `Ошибка (${res.status})`, res.status);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: directKey });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
  });
}
