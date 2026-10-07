/**
 * The FAQ's topics, in order. Static, app-owned content (see the `customerCenter.faq.<topic>` locale keys): no
 * backend, available offline, and only describing what the app does today.
 */
export const FAQ_TOPICS = ['saveLinks', 'collections', 'archive', 'sharedCollections', 'locks', 'trash'] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number];
