namespace Juple.Domain.Users;

/// <summary>
/// LEGACY - retained only for storage/API compatibility (Users.Plan column, the bootstrap response's
/// "plan" field). The Free/Plus tier model has been dropped: every active user gets the same
/// features, so no feature, limit, or UI may branch on this value (e.g. the trash list limit is the
/// same ItemTrashLimits.ListLimit for everyone). The future paid model (trial period, then a
/// subscription) is expected to replace this with its own subscription/entitlement state in a
/// separate change - not by reviving Plus. Every new User is still written as Free (see
/// CurrentUserProvisioningStore.CreateAsync) and nothing calls SetPlan. Persisted as a string (see
/// UserConfiguration) so reordering these members can never change the meaning of an existing row.
/// </summary>
public enum UserPlan
{
    Free,
    Plus,
}
