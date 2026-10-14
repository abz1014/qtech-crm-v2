import { QueryClient } from '@tanstack/react-query'

/**
 * The app's one query client. A module singleton (not React context) so non-React code, such as a
 * command-palette source, can use the same cache as the screens.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})
