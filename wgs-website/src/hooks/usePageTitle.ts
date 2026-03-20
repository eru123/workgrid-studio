import { useEffect } from "react";

/**
 * Updates document.title on the client after client-side navigation.
 * Pre-rendered HTML already has the correct title from the SSG plugin;
 * this hook keeps the browser tab title in sync when navigating within the SPA.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
