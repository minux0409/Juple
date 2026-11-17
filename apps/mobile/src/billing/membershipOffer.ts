import type { AuthState } from '../auth/types';

/**
 * Whether the app offers the membership (the 멤버십 row on My Page, the Membership screen, the store catalog read): the program is
 * launched, or the server offers the purchase to this account before the launch (a preview account - App Review, internal testers).
 * Never a build-time switch, never decided on the device. The free month and the read-only restriction still follow
 * `entitlement.programEnabled` alone.
 */
export function isMembershipOffered(auth: Pick<AuthState, 'entitlement' | 'membershipOffered'> | null | undefined): boolean {
  return auth?.entitlement?.programEnabled === true || auth?.membershipOffered === true
    || Boolean(auth?.entitlement?.complimentaryAccessEndsAtUtc);
}
