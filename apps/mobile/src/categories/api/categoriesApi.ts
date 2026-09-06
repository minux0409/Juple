/**
 * The Category reference embedded in Item read responses - id/name only. Category management UI
 * (create/rename/delete/assign, and the old Wishlist/Archive category filter) has been removed
 * from Mobile as part of the Collections-centric IA; this type only remains because the Backend
 * still returns it on Item DTOs (kept for compatibility, not surfaced anywhere in the UI).
 */
export interface ItemCategory {
  readonly id: number;
  readonly name: string;
}
