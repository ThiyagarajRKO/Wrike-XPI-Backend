import { useCallback, useEffect, useState } from "react";

/**
 * Like useState, but backed by the URL hash (#overview, #environments, ...)
 * so a refresh (or a shared/bookmarked link) lands back on the same
 * dashboard section instead of always resetting to the default. Neither the
 * original EJS dashboards nor this app ever persisted the active tab before
 * (checked the full git history) - this is a new capability, not a restored
 * one. Uses history.replaceState (not location.hash=) so switching tabs
 * doesn't spam the browser's back-button history; back/forward and manual
 * hash edits are still picked up via the hashchange listener.
 */
export function useHashPage<T extends string>(
  validValues: readonly T[],
  defaultValue: T,
): [T, (value: T) => void] {
  const readHash = useCallback((): T => {
    const raw = window.location.hash.replace(/^#/, "");
    return (validValues as readonly string[]).includes(raw) ? (raw as T) : defaultValue;
  }, [validValues, defaultValue]);

  const [page, setPage] = useState<T>(readHash);

  useEffect(() => {
    const onHashChange = () => setPage(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [readHash]);

  const setPageAndHash = useCallback((value: T) => {
    setPage(value);
    const url = `${window.location.pathname}${window.location.search}#${value}`;
    window.history.replaceState(null, "", url);
  }, []);

  return [page, setPageAndHash];
}
