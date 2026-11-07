import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OrderListSchema, OrderResultSchema, SourcesIndexSchema, type OrderInput, type OrderList, type SourcesIndex } from "../../shared/schemas";
import { apiGet, apiPost } from "./client";
import { mediaKey } from "./media";

export const ordersKey = ["orders"] as const;
export const sourcesKey = ["sources"] as const;

export function useOrders() {
  return useQuery<OrderList>({ queryKey: ordersKey, queryFn: () => apiGet("/orders", OrderListSchema), staleTime: 15_000, refetchInterval: 60_000 });
}

export function useSources() {
  return useQuery<SourcesIndex>({ queryKey: sourcesKey, queryFn: () => apiGet("/orders/sources", SourcesIndexSchema), staleTime: 10 * 60_000 });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => apiPost("/orders", OrderResultSchema, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ordersKey }),
  });
}

export type OrderAction = "revise" | "comment" | "accept" | "cancel";
export function useOrderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, text }: { id: number; action: OrderAction; text?: string }) =>
      apiPost(`/orders/${id}/${action}`, OrderResultSchema, text === undefined ? {} : { text }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ordersKey });
      void qc.invalidateQueries({ queryKey: mediaKey });
    },
  });
}
