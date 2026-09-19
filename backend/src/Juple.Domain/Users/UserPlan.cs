namespace Juple.Domain.Users;

/// <summary>
/// A User's current entitlement tier - the single source of truth other modules (Collections
/// restore limits, Notifications) branch on. Every new User starts on Free (see
/// CurrentUserProvisioningStore.CreateAsync); Plus is only ever set by an explicit SetPlan call.
/// No payment provider is wired up yet, so nothing currently calls SetPlan with Plus - this only
/// establishes the entitlement itself, not a billing integration. Persisted as a string (see
/// UserConfiguration) so reordering these members can never change the meaning of an existing row.
/// </summary>
public enum UserPlan
{
    Free,
    Plus,
}
