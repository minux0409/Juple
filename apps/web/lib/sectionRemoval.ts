/**
 * Taking one link out of the date sections the person is looking at, at once (pure, so it is unit-tested): the link leaves the page
 * that holds it, its section's count goes down by one and a section left with nothing disappears. What is not loaded cannot be
 * changed here - the server's own counts are read again right after and settle it.
 */
export interface CountedSection {
  readonly key: string;
  readonly count: number;
}

export function removeItemFromSections<S extends CountedSection, P>(
  sections: readonly S[],
  pages: ReadonlyMap<string, P>,
  itemId: number,
  itemsOf: (page: P) => readonly { readonly id: number }[] | null,
  withoutItem: (page: P, itemId: number) => P,
): { readonly sections: readonly S[]; readonly pages: ReadonlyMap<string, P>; readonly removed: boolean } {
  const holder = [...pages.entries()].find(([, page]) => itemsOf(page)?.some(item => item.id === itemId) === true);
  if (!holder) {
    return { sections, pages, removed: false };
  }
  const [key, page] = holder;
  const nextPages = new Map(pages).set(key, withoutItem(page, itemId));
  const nextSections = sections.flatMap(section => {
    if (section.key !== key) {
      return [section];
    }
    return section.count <= 1 ? [] : [{ ...section, count: section.count - 1 }];
  });
  if (nextSections.length < sections.length) {
    nextPages.delete(key);
  }
  return { sections: nextSections, pages: nextPages, removed: true };
}
