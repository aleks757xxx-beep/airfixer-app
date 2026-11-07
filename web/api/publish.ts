import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BufferPostListSchema,
  ChannelListSchema,
  ComposeResultSchema,
  OkSchema,
  PostResultSchema,
  type BufferPostList,
  type ChannelList,
  type ComposeInput,
} from "../../shared/schemas";
import { ApiRequestError, apiGet, apiPost } from "./client";
import { ApiErrorSchema } from "../../shared/schemas";

export const channelsKey = ["channels"] as const;
export const postsKey = ["posts"] as const;

export function useChannels() {
  return useQuery<ChannelList>({ queryKey: channelsKey, queryFn: () => apiGet("/publish/channels", ChannelListSchema), staleTime: 5 * 60_000 });
}

export function usePosts(from: number, to: number) {
  return useQuery<BufferPostList>({
    queryKey: [...postsKey, from, to],
    queryFn: () => apiGet(`/publish/posts?from=${from}&to=${to}`, BufferPostListSchema),
    staleTime: 30_000,
    refetchInterval: 120_000,
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
    mutationFn: ({ id, text }: { id: string; text: string }) => apiPost(`/publish/posts/${encodeURIComponent(id)}/text`, PostResultSchema, { text }),
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
