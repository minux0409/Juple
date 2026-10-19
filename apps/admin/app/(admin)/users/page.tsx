'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminPaths, displayJupleId, formatCount, formatInstant, type AdminUserRow } from '../../../lib/adminModel';
import { strings } from '../../../lib/strings';
import { PageState } from '../AdminRoot';
import { usePagedList } from '../usePagedList';

/** 사용자: read-only directory, newest first; the search is an exact Juple ID (the API normalizes "@", "-" and case). */
export default function UsersPage() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const list = usePagedList<AdminUserRow>(search ?? '', cursor => adminPaths.users(search, cursor));

  return (
    <>
      <header className="page-header">
        <h1>{strings.usersTitle}</h1>
      </header>
      <p className="muted">{strings.usersReadOnlyNote}</p>
      <form
        className="search"
        onSubmit={event => {
          event.preventDefault();
          setSearch(input.trim() || null);
        }}
      >
        <input
          aria-label={strings.userJupleId}
          autoComplete="off"
          maxLength={20}
          onChange={event => setInput(event.target.value)}
          placeholder={strings.usersSearchPlaceholder}
          value={input}
        />
        <button className="primary" type="submit">
          {strings.usersSearch}
        </button>
        {search ? (
          <button
            onClick={() => {
              setInput('');
              setSearch(null);
            }}
            type="button"
          >
            {strings.usersClear}
          </button>
        ) : null}
      </form>
      <table>
        <thead>
          <tr>
            <th>{strings.userJupleId}</th>
            <th>{strings.userDisplayName}</th>
            <th>{strings.userCreatedAt}</th>
            <th>{strings.userLocale}</th>
            <th>{strings.userTerms}</th>
            <th>{strings.userLinks}</th>
            <th>{strings.userCollections}</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map(user => (
            <tr key={user.userId}>
              <td className="ltr">
                <Link aria-label={`${displayJupleId(user.jupleId)} ${strings.userDetailOpen}`} href={`/users/${user.userId}`}>
                  {displayJupleId(user.jupleId)}
                </Link>
              </td>
              <td>{user.displayName ?? '-'}</td>
              <td>{formatInstant(user.createdAtUtc)}</td>
              <td className="ltr">{user.preferredLocale}</td>
              <td>{user.termsAccepted ? strings.yes : strings.no}</td>
              <td>{formatCount(user.linkCount)}</td>
              <td>{formatCount(user.collectionCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.error && list.items.length === 0 ? <p className="state">{strings.empty}</p> : null}
      <PageState error={list.error} loading={list.loading} onRetry={list.retry} />
      {list.hasMore && !list.loading && !list.error ? (
        <button className="load-more" onClick={list.loadMore} type="button">
          {strings.loadMore}
        </button>
      ) : null}
    </>
  );
}
