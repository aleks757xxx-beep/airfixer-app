import { useQuery } from "@tanstack/react-query";
import { HealthSchema, type Health } from "../../shared/schemas";
import { apiGet } from "./client";

export function useHealth() {
  return useQuery<Health>({
    queryKey: ["health"],
    queryFn: () => apiGet("/health", HealthSchema),
    staleTime: 30_000,
  });
}
