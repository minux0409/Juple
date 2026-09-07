namespace Juple.Application.Users.DeleteAccount;

/// <summary>
/// Deletes every SQL row this user owns - across every module - in a single transaction, in an
/// order that satisfies the schema's FK constraints (every direct UserId FK is NoAction except
/// ExternalIdentity, which is Cascade), finishing with the User row itself. A no-op (not an error)
/// for a userId that does not exist or already has no owned data.
///
/// Also durably registers a Blob cleanup task (see AccountDeletionBlobCleanup) for
/// blobCleanupPrefix, in the SAME transaction as the data deletion - so a failed deletion never
/// leaves an orphan cleanup task, and a committed one is always guaranteed to have one. Does not
/// itself touch Blob Storage - see IBlobCleanupService, which IDeleteAccountService calls
/// immediately afterward using the Id this method returns.
/// </summary>
public interface IAccountDeletionStore
{
    Task<long> DeleteAllDataAsync(
        long userId,
        string blobCleanupPrefix,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);
}
