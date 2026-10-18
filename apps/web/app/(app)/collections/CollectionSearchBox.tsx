'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isSessionLost } from '../../../lib/authSession';
import {
  COLLECTION_SUGGESTION_DEBOUNCE_MS,
  collectionSuggestionsPath,
  nextSuggestionIndex,
  suggestionKey,
  suggestionRows,
  type CollectionSuggestionRow,
  type CollectionSuggestions,
} from '../../../lib/collectionSuggestions';
import { normalizeCollectionSearch, type CollectionFilter, type CollectionSummary } from '../../../lib/collectionsView';
import { useSignedInApp } from '../AppRoot';
import { SearchField } from '../SearchField';
import { SiteIcon } from '../SiteIcon';
import styles from '../app.module.css';

/**
 * The Collections search box with its quick suggestions: while the box has focus and text, a small panel floats under it with a few
 * matching Collections and links (the server's GET /collections/search-suggestions, for the tab that is open). The panel is an overlay -
 * it never moves the list below - and a help only: the list itself is read by the screen from the same text, and a failing suggestion
 * request merely leaves the panel away.
 *
 * A combobox with a listbox: ArrowDown / ArrowUp move through the rows, Enter opens the highlighted one, Escape closes the panel.
 */
export function CollectionSearchBox({
  filter,
  text,
  onTextChange,
  renderCollectionTile,
}: {
  readonly filter: CollectionFilter;
  readonly text: string;
  readonly onTextChange: (next: string) => void;
  /** The Collection's own tile (the list's), passed in so this file does not import the screen that renders it. */
  readonly renderCollectionTile: (collection: CollectionSummary, size: number) => ReactNode;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const listId = useId();
  const [focused, setFocused] = useState(false);
  // Closed by Escape / a choice until the text changes or the arrows are used again.
  const [dismissed, setDismissed] = useState(false);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly filter: CollectionFilter; readonly data: CollectionSuggestions | null } | null>(null);
  const [active, setActive] = useState(-1);

  const term = normalizeCollectionSearch(text);
  const key = suggestionKey(filter, term);
  const wantsSuggestions = focused && term !== '';

  useEffect(() => {
    if (!wantsSuggestions) {
      return;
    }
    // One request after a pause in the typing; a later text / tab (or leaving the box) cancels it and drops an answer that is late, so
    // the answer of "t" can never replace the one of "tian".
    let ignore = false;
    const timer = setTimeout(() => {
      api<CollectionSuggestions>({ path: collectionSuggestionsPath(filter, term) }).then(
        data => {
          if (!ignore) {
            setAnswer({ key, filter, data });
          }
        },
        error => {
          if (ignore) {
            return;
          }
          if (isSessionLost(error)) {
            onSessionLost();
            return;
          }
          // The suggestions are a help: a failure leaves the panel away and nothing else - the list is unaffected.
          setAnswer({ key, filter, data: null });
        },
      );
    }, COLLECTION_SUGGESTION_DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [api, filter, key, onSessionLost, term, wantsSuggestions]);

  // The previous answer of the same tab stays until the new one arrives (no flicker); another tab's answer is never drawn.
  const shown = answer !== null && answer.filter === filter ? answer.data : null;
  const loading = answer?.key !== key;
  const groups = suggestionRows(shown);
  const rows: readonly CollectionSuggestionRow[] = [...groups.collections, ...groups.links];
  const open = focused && !dismissed && term !== '' && rows.length > 0;
  const activeIndex = open && active >= 0 && active < rows.length ? active : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const change = (next: string) => {
    setDismissed(false);
    setActive(-1);
    onTextChange(next);
  };

  const choose = (row: CollectionSuggestionRow) => {
    setDismissed(true);
    setActive(-1);
    router.push(row.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length > 0 && term !== '') {
      event.preventDefault();
      setDismissed(false);
      setActive(nextSuggestionIndex(open ? activeIndex : -1, rows.length, event.key));
      return;
    }
    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      choose(rows[activeIndex]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActive(-1);
    }
  };

  return (
    <div
      className={styles.suggestAnchor}
      onBlur={event => {
        // Focus moving to a row inside the panel is still "in the box"; anywhere else closes it.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <SearchField
        inputProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': open,
          'aria-controls': open ? listId : undefined,
          'aria-activedescendant': activeIndex >= 0 ? optionId(activeIndex) : undefined,
          autoComplete: 'off',
          onFocus: () => setFocused(true),
          onKeyDown,
        }}
        onChange={change}
        placeholder={dictionary.collectionListSearchPlaceholder}
        value={text}
      />
      {open ? (
        <div
          aria-busy={loading}
          aria-label={dictionary.collectionListSearchPlaceholder}
          className={loading ? `${styles.suggestPanel} ${styles.suggestPanelBusy}` : styles.suggestPanel}
          data-collection-suggestions
          id={listId}
          // Keep the focus in the input while a row is pressed, so the panel is not closed before the click lands.
          onMouseDown={event => event.preventDefault()}
          role="listbox"
        >
          {groups.collections.length > 0 ? (
            <div aria-label={dictionary.navCollections} role="group">
              <div aria-hidden className={styles.suggestHeading}>
                {dictionary.navCollections}
              </div>
              {groups.collections.map((row, index) => (
                <SuggestionOption active={activeIndex === index} id={optionId(index)} key={row.key} onChoose={() => choose(row)} renderCollectionTile={renderCollectionTile} row={row} />
              ))}
            </div>
          ) : null}
          {groups.links.length > 0 ? (
            <div aria-label={dictionary.collectionSearchLinks} role="group">
              <div aria-hidden className={styles.suggestHeading}>
                {dictionary.collectionSearchLinks}
              </div>
              {groups.links.map((row, index) => {
                const position = groups.collections.length + index;
                return <SuggestionOption active={activeIndex === position} id={optionId(position)} key={row.key} onChoose={() => choose(row)} renderCollectionTile={renderCollectionTile} row={row} />;
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionOption({
  row,
  id,
  active,
  onChoose,
  renderCollectionTile,
}: {
  readonly row: CollectionSuggestionRow;
  readonly renderCollectionTile: (collection: CollectionSummary, size: number) => ReactNode;
  readonly id: string;
  readonly active: boolean;
  readonly onChoose: () => void;
}) {
  return (
    <Link
      aria-selected={active}
      className={active ? `${styles.suggestOption} ${styles.suggestOptionActive}` : styles.suggestOption}
      data-suggestion={row.kind}
      href={row.href}
      id={id}
      onClick={onChoose}
      role="option"
      tabIndex={-1}
    >
      {row.kind === 'collection' ? (
        <>
          {renderCollectionTile(row.collection, 32)}
          <span className={styles.suggestText}>
            <span className={styles.suggestTitle} dir="auto">
              {row.collection.name}
            </span>
          </span>
        </>
      ) : (
        <>
          <span aria-hidden className={styles.suggestSite}>
            <SiteIcon siteId={row.siteId} size={20} />
          </span>
          <span className={styles.suggestText}>
            <span className={styles.suggestTitle} dir="auto">
              {row.title}
            </span>
            <span className={styles.suggestDetail} dir="auto">
              {row.detail}
            </span>
          </span>
        </>
      )}
    </Link>
  );
}
