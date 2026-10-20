namespace Juple.Application.Billing;

/// <summary>
/// What a retention deletion WOULD do for one account - counts only, computed read-only (the dry-run of RET-06). Nothing in this build
/// deletes anything: there is no deletion job, no flag that enables one, and this plan is only ever read.
///
/// The protection rules it encodes (docs/RELEASE_BACKLOG.md "DATA RETENTION", decisions 1 and 2):
/// - Collections someone ELSE owns are never touched.
/// - A Collection the account owns that still has members is KEPT (read-only for its members) - never deleted for everyone. Ownership
///   transfer or a member's own copy is the way out, offered from the first notice on.
/// - A link of the account that is in another owner's Collection, or in a kept Collection, is KEPT so nobody else loses it; only its
///   private parts (memo, uploaded photos) would be cleared.
/// - Everything else the account owns (its other links, trash included, their photos, and its Collections without members) would be deleted.
/// </summary>
public sealed record DataRetentionDeletionPlan(
    int LinksToDelete,
    int LinksKeptForOthers,
    int PhotosToDelete,
    int PhotosOfKeptLinksToClear,
    int CollectionsToDelete,
    int CollectionsKeptWithMembers);

public interface IDataRetentionDeletionPlanner
{
    Task<DataRetentionDeletionPlan> PlanAsync(long userId, CancellationToken cancellationToken = default);
}
