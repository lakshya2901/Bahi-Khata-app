import { useSyncExternalStore } from 'react';

// A tiny router built on the browser history, so the Back and Forward buttons move one step at a time:
// page -> category -> brand, and shop -> bill. Each step is a real history entry in the address bar
// (for example  #/inventory?c=<category>&b=<brand>  or  #/pos?step=cart).

interface HistoryState { idx: number; tag?: string }

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emit);   // Back / Forward buttons
  window.addEventListener('hashchange', emit); // the address typed or edited by hand
  if ((history.state as HistoryState | null)?.idx === undefined) history.replaceState({ idx: 0 } satisfies HistoryState, '');
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Re-renders when the address changes. Returns the current hash, e.g. "#/pos?step=cart". */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function parseHash(hash: string): { page: string; params: URLSearchParams } {
  const [page, query] = hash.replace(/^#\/?/, '').split('?');
  return { page, params: new URLSearchParams(query ?? '') };
}

interface NavOptions {
  /** Change the current entry instead of adding a new one. */
  replace?: boolean;
  /** A label stored with the entry, readable later with currentTag(). */
  tag?: string;
}

export function navigate(hash: string, opts: NavOptions = {}) {
  if (hash === window.location.hash) return;
  const idx = ((history.state as HistoryState | null)?.idx ?? 0) + (opts.replace ? 0 : 1);
  const state: HistoryState = { idx, tag: opts.tag };
  if (opts.replace) history.replaceState(state, '', hash);
  else history.pushState(state, '', hash);
  emit();
}

/** Change parts of the address (`null` removes one) while staying on the same page. */
export function setParams(updates: Record<string, string | null>, opts: NavOptions = {}) {
  const { page, params } = parseHash(window.location.hash);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const query = params.toString();
  navigate(`#/${page}${query ? `?${query}` : ''}`, opts);
}

export const currentTag = () => (history.state as HistoryState | null)?.tag;
export const goBack = () => history.back();
