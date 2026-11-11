import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OkSchema } from "../../shared/schemas";
import {
  ReviewNoteResultSchema,
  ReviewStateSchema,
  VoiceDefaultResultSchema,
  type ReviewNoteInput,
  type ReviewState,
  type VoiceSettings,
} from "../../shared/review";
import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import { mediaKey } from "./media";

const reviewKey = (mediaId: string) => ["review", mediaId] as const;

export function useReview(mediaId: string) {
  return useQuery<ReviewState>({ queryKey: reviewKey(mediaId), queryFn: () => apiGet(`/review/${mediaId}`, ReviewStateSchema), staleTime: 10_000, refetchInterval: 60_000 });
}

function useRefresh(mediaId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: reviewKey(mediaId) });
    void qc.invalidateQueries({ queryKey: mediaKey });
  };
}

export function useAddNote(mediaId: string) {
  const refresh = useRefresh(mediaId);
  return useMutation({ mutationFn: (n: ReviewNoteInput) => apiPost(`/review/${mediaId}/notes`, ReviewNoteResultSchema, n), onSuccess: refresh });
}
export function useEditNote(mediaId: string) {
  const refresh = useRefresh(mediaId);
  return useMutation({ mutationFn: ({ id, ...n }: ReviewNoteInput & { id: string }) => apiPut(`/review/${mediaId}/notes/${id}`, ReviewNoteResultSchema, n), onSuccess: refresh });
}
export function useDeleteNote(mediaId: string) {
  const refresh = useRefresh(mediaId);
  return useMutation({ mutationFn: (id: string) => apiDelete(`/review/${mediaId}/notes/${id}`, OkSchema), onSuccess: refresh });
}
export function useSaveVoice(mediaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (voice: VoiceSettings | null) => apiPut(`/review/${mediaId}/voice`, ReviewStateSchema, { voice }),
    onSuccess: (s) => qc.setQueryData(reviewKey(mediaId), s),
  });
}
export function useSaveVoiceDefault(mediaId: string) {
  const refresh = useRefresh(mediaId);
  return useMutation({ mutationFn: (voice: VoiceSettings) => apiPut("/review/voice-default", VoiceDefaultResultSchema, { voice }), onSuccess: refresh });
}
export function useSendReview(mediaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId?: number) => apiPost(`/review/${mediaId}/send`, ReviewStateSchema, orderId ? { orderId } : {}),
    onSuccess: (s) => {
      qc.setQueryData(reviewKey(mediaId), s);
      void qc.invalidateQueries({ queryKey: mediaKey });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
