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
import { Glyph } from '../Glyph';
import { SiteIcon } from '../SiteIcon';
import styles from '../app.module.css';

/**
 * The Collections search box with its quick suggestions: while the box has focus and text, a small panel floats under it with a few
 * matching Collections and links (the server's GET /collections/search-suggestions, for the tab that is open). The panel is an overlay -
 * it never moves the list below - and a help only: the list itself is read by the screen from the same text, and a failing suggestion
 * request merely leaves the panel away.
 *
 * The panel is plain content under a search box - a region with two lists of real links - not a listbox: it also holds the "open original"
 * link of a row, and an interactive link has no place inside a listbox / option. Every link is a normal tab stop. ArrowDown / ArrowUp
 * additionally move a highlight through the Juple rows (announced through aria-activedescendant on the input), Enter opens the highlighted
 * one, Escape closes the panel (from the input or from a link inside it).
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
  const rowId = (index: number) => `${listId}-row-${index}`;

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
  };

  // Escape closes the panel from the input or from a link inside it (and brings the focus back to the input).
  const onEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActive(-1);
      event.currentTarget.querySelector('input')?.focus();
    }
  };

  return (
    <div
      className={styles.suggestAnchor}
      onKeyDown={onEscape}
      onBlur={event => {
        // Focus moving to a row inside the panel is still "in the box"; anywhere else closes it.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <SearchField
        inputProps={{
          'aria-controls': open ? listId : undefined,
          'aria-activedescendant': activeIndex >= 0 ? rowId(activeIndex) : undefined,
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
          role="region"
        >
          {groups.collections.length > 0 ? (
            <div>
              <div className={styles.suggestHeading} id={`${listId}-collections`}>
                {dictionary.navCollections}
              </div>
              <ul aria-labelledby={`${listId}-collections`} className={styles.suggestList}>
                {groups.collections.map((row, index) => (
                  <li key={row.key}>
                    <SuggestionRow active={activeIndex === index} id={rowId(index)} onChoose={() => choose(row)} openLabel={dictionary.openLink} renderCollectionTile={renderCollectionTile} row={row} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {groups.links.length > 0 ? (
            <div>
              <div className={styles.suggestHeading} id={`${listId}-links`}>
                {dictionary.collectionSearchLinks}
              </div>
              <ul aria-labelledby={`${listId}-links`} className={styles.suggestList}>
                {groups.links.map((row, index) => {
                  const position = groups.collections.length + index;
                  return (
                    <li key={row.key}>
                      <SuggestionRow active={activeIndex === position} id={rowId(position)} onChoose={() => choose(row)} openLabel={dictionary.openLink} renderCollectionTile={renderCollectionTile} row={row} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionRow({
  row,
  id,
  active,
  onChoose,
  openLabel,
  renderCollectionTile,
}: {
  readonly row: CollectionSuggestionRow;
  readonly openLabel: string;
  readonly renderCollectionTile: (collection: CollectionSummary, size: number) => ReactNode;
  readonly id: string;
  readonly active: boolean;
  readonly onChoose: () => void;
}) {
  const option = (
    <Link
      aria-current={active ? 'true' : undefined}
      className={active ? `${styles.suggestOption} ${styles.suggestOptionActive}` : styles.suggestOption}
      data-suggestion={row.kind}
      href={row.href}
      id={id}
      onClick={onChoose}
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
  if (row.kind !== 'link' || row.externalUrl === null) {
    return option;
  }
  // A link row = the Juple link (what ArrowUp / ArrowDown / Enter act on) and, NEXT to it - never inside it, an anchor cannot nest in an
  // anchor - the original page. Its click is its own: it opens the saved address in a new tab and never reaches the Juple link, so the row
  // does not also navigate. Both are real links and normal tab stops.
  return (
    <div className={styles.suggestRow} data-suggestion-row>
      {option}
      <a
        aria-label={openLabel}
        className={styles.suggestExternal}
        data-suggestion-external
        href={row.externalUrl}
        rel="noopener noreferrer"
        target="_blank"
        title={openLabel}
      >
        <Glyph name="ExternalLink" size={18} />
      </a>
    </div>
  );
}
