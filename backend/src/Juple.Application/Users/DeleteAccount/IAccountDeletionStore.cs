using Juple.Application.Identity;

namespace Juple.Application.Users.DeleteAccount;

/// <param name="RegisterEntraIdentityDeletion">Also durably registers the deletion of the Entra sign-in account (same transaction).</param>
/// <param name="TrialEmailHash">Keyed hash of the sign-in email: when the account has a trial window, it is remembered in the ledger under this hash so signing up again cannot restart the 30 days.</param>
public sealed record AccountDeletionPlan(string BlobCleanupPrefix, DateTimeOffset CreatedAtUtc, bool RegisterEntraIdentityDeletion, byte[]? TrialEmailHash);

public sealed record AccountDeletionResult(long BlobCleanupTaskId, long? EntraDeletionTaskId);

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

    /// <summary>The stored external (Entra) identity of this user - resolved by the server from its own data, never from a request.</summary>
    Task<ExternalIdentityPrincipal?> GetExternalIdentityAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Same deletion, with the optional Entra-deletion task and trial-ledger memory (see <see cref="AccountDeletionPlan"/>), all in the one transaction.</summary>
    Task<AccountDeletionResult> DeleteAllDataAsync(long userId, AccountDeletionPlan plan, CancellationToken cancellationToken = default);
}
