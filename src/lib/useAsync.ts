import { useCallback, useEffect, useRef, useState } from "react";

/* ===========================================================================
   Data loading
   ---------------------------------------------------------------------------
   Every screen reads from SQLite through `invoke`. These hooks keep the
   loading / error / reload state in one place so pages stay declarative and a
   failed read always produces a visible, retryable error instead of a blank
   panel.
   =========================================================================== */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

/**
 * Runs `loader` whenever `deps` change. Results arriving after unmount, or after
 * a newer run started, are discarded so a slow query can never overwrite fresh
 * data.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { skip?: boolean } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options.skip);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (options.skip) {
      setLoading(false);
      return;
    }
    const ticket = ++run.current;
    setLoading(true);
    void (async () => {
      try {
        const result = await loaderRef.current();
        if (run.current !== ticket) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (run.current !== ticket) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (run.current === ticket) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, options.skip]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const update = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setData((prev) =>
      typeof updater === "function"
        ? (updater as (p: T | null) => T | null)(prev)
        : updater,
    );
  }, []);

  return { data, loading, error, reload, setData: update };
}

/** Debounces a rapidly changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Keeps a page pinned to page 1 when the result set shrinks under it. */
export function usePage<T>(rows: T[], pageSize: number): [number, (p: number) => void, number] {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return [page, setPage, pages];
}
