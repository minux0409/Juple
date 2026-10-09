/**
 * The reply target ("@name", rendered once from the server's reply-to metadata) is NOT part of the written text:
 * a new reply's body is exactly what the person typed.
 *
 * Backward compatibility only: before the composer stopped prefilling "@name ", a reply to another reply was
 * stored WITH that leading "@name " in its body, which then showed twice next to the metadata mention. When the
 * body still begins with exactly the reply target's own "@name" followed by whitespace, that ONE redundant lead
 * is dropped for display. Anything else is kept as written: a different @name, the same name later in the text,
 * a name that merely starts with the target's (a longer name), or a body that is only the mention.
 */
export function stripLegacyReplyMention(body: string, targetName: string | null): string {
  if (!targetName) {
    return body;
  }
  const mention = `@${targetName}`;
  if (!body.startsWith(mention)) {
    return body;
  }
  const rest = body.slice(mention.length);
  // Must be followed by whitespace (not another name character) and leave real words behind.
  if (!/^\s/.test(rest)) {
    return body;
  }
  const remainder = rest.replace(/^\s+/, '');
  return remainder.length > 0 ? remainder : body;
}
