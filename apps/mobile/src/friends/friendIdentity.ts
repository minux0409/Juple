import { formatJupleId } from '../collections/api/collaborationApi';

/** How the Friends screens show a Juple ID: "@K7MP-4Q8N". */
export function atJupleId(jupleId: string): string {
  return `@${formatJupleId(jupleId)}`;
}

/**
 * The primary line for a person: their nickname, else their @Juple ID - never an email or any
 * other private detail (the DTOs carry none).
 */
export function friendPrimaryLabel(person: { readonly jupleId: string; readonly displayName?: string | null }): string {
  return person.displayName?.trim() ? person.displayName : atJupleId(person.jupleId);
}

/**
 * The typed Juple ID as the server's lookup expects it. People copy IDs as shown here, with the
 * leading "@" - that one character is dropped; everything else (hyphens, spaces, letter case,
 * validity) stays the server's to normalize and judge.
 */
export function jupleIdForLookup(input: string): string {
  return input.trim().replace(/^@/, '');
}
