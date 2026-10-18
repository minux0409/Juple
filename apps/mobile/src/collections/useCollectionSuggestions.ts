import { useEffect, useState } from 'react';
import { getCollectionSuggestions, type CollectionListScope, type CollectionSearchSuggestions } from './api/collectionsApi';
import { suggestionKey } from './collectionSuggestions';
import { normalizeCollectionSearch } from './collectionSearch';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';

/** The same pause as the list's own search, so one burst of keys is one request of each. */
export const SUGGESTION_DEBOUNCE_MS = 250;

interface Answer {
  readonly key: string;
  readonly scope: CollectionListScope;
  readonly data: CollectionSearchSuggestions | null;
}

/**
 * The suggestions for the text in the Collections search box, for the open tab. Asks only while `enabled` (the box has focus) and the
 * text is not blank; every change cancels the pending request and drops a late answer, so the answer of "t" can never replace the one
 * of "tian". A failure is silent: `suggestions` is simply null and nothing else on the screen is affected.
 */
export function useCollectionSuggestions(request: AuthenticatedApiRequest, scope: CollectionListScope, text: string, enabled: boolean) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const term = normalizeCollectionSearch(text);
  const key = suggestionKey(scope, term);
  const wanted = enabled && term !== '';

  useEffect(() => {
    if (!wanted) {
      return;
    }
    let ignore = false;
    const timer = setTimeout(() => {
      getCollectionSuggestions(request, { scope, search: term }).then(
        data => {
          if (!ignore) {
            setAnswer({ key, scope, data });
          }
        },
        () => {
          if (!ignore) {
            setAnswer({ key, scope, data: null });
          }
        },
      );
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [key, request, scope, term, wanted]);

  return {
    // The previous answer of the same tab stays until the new one arrives (no flicker); another tab's answer is never drawn.
    suggestions: wanted && answer !== null && answer.scope === scope ? answer.data : null,
    isLoading: wanted && answer?.key !== key,
  };
}
