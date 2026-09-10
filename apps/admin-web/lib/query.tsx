"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Factory — pure, testable, no singleton side-effects at import time.
 * Keeps query defaults minimal and predictable.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * App-wide provider — must wrap the dashboard tree.
 * Uses useState lazy init so each browser session gets exactly one client,
 * while SSR / build does not share a global instance.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Re-export common hooks for ergonomic imports:
 * import { useQuery } from "@/lib/query"
 */
export { useQuery, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
