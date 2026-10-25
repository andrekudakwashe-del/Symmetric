import { lazy, ComponentType } from 'react';

/**
 * Resilient dynamic module loader that handles network interruptions,
 * Vite development server restarts, and stale browser chunk caches.
 *
 * If a dynamic import fails (e.g. TypeError: Failed to fetch dynamically imported module),
 * it attempts a fast retry, and if still unsuccessful, automatically does a single
 * session-guarded reload so the user never gets stranded with an unhandled exception.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T } | { [key: string]: any }>,
  moduleName?: string
) {
  return lazy(async () => {
    const storageKey = `retry-lazy-${moduleName || 'chunk'}`;
    const hasRetriedInSession = sessionStorage.getItem(storageKey) === 'true';

    try {
      const module = await factory();
      sessionStorage.removeItem(storageKey);
      if ('default' in module && module.default) {
        return { default: module.default as T };
      }
      // If module is exported as named export matching component
      const keys = Object.keys(module);
      const foundComponent = keys.find((k) => typeof module[k] === 'function') || keys[0];
      return { default: (foundComponent ? module[foundComponent] : module) as T };
    } catch (initialError: any) {
      console.warn(`[LazyLoader] First attempt failed for ${moduleName || 'module'}:`, initialError?.message);

      // Fast retry after a short delay
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const retryModule = await factory();
        sessionStorage.removeItem(storageKey);
        if ('default' in retryModule && retryModule.default) {
          return { default: retryModule.default as T };
        }
        const keys = Object.keys(retryModule);
        const found = keys.find((k) => typeof retryModule[k] === 'function') || keys[0];
        return { default: (found ? retryModule[found] : retryModule) as T };
      } catch (retryError: any) {
        console.error(`[LazyLoader] Retry failed for ${moduleName || 'module'}:`, retryError?.message);

        // If we haven't forced a reload in this session, reload the page to pick up the fresh assets
        if (!hasRetriedInSession && typeof window !== 'undefined') {
          sessionStorage.setItem(storageKey, 'true');
          window.location.reload();
          // Return a hanging promise while page reloads
          return new Promise<{ default: T }>(() => {});
        }

        // Rethrow if already retried
        throw retryError;
      }
    }
  });
}
