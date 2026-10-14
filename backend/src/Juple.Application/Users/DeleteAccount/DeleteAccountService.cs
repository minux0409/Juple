using Juple.Application.Billing;
using Juple.Application.Collections.Locking;
using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;

namespace Juple.Application.Users.DeleteAccount;

/// <summary>
/// Deletes the account: every Juple row the user owns, their Blobs, and - when <see cref="EntraAccountDeletionOptions.Enabled"/> -
/// the Entra External ID sign-in account itself, so the same email and password cannot sign in again (a returning person
/// must sign up anew).
///
/// Order, and why: SQL and Entra cannot share a transaction. Juple data goes FIRST, together with a durable "delete this Entra
/// user" task written in the same transaction (a committed deletion always has the task). Deleting Entra first would let the
/// person lose the ability to sign in while their data survives and they can no longer retry. The Entra call is then tried
/// immediately; if it fails the task stays and the retry job finishes it (idempotent: "already gone" is success), and until it
/// is done a new account for that identity is refused (CurrentUserBootstrapService), so the old password never yields a fresh account.
/// The Entra user to delete is the stored identity of THIS user - never an id from a request.
/// </summary>
public sealed class DeleteAccountService(
    IAccountDeletionStore accountDeletionStore,
    IItemImageStorage itemImageStorage,
    IBlobCleanupService blobCleanupService,
    IEntraIdentityDirectory entraDirectory,
    IEntraIdentityDeletionService entraDeletionService,
    ITrialIdentityHasher trialIdentityHasher,
    IEntitlementService entitlementService,
    EntraAccountDeletionOptions entraOptions,
    TimeProvider timeProvider) : IDeleteAccountService
{
    public Task DeleteRecentlyAuthenticatedAsync(long userId, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default)
    {
        // The same rule (5 minutes, auth_time only, never iat or a client flag) as replacing the
        // Collection lock password - one definition of "signed in again just now".
        RecentAuthentication.Require(authenticatedAtUtc, timeProvider.GetUtcNow());
        return DeleteAsync(userId, cancellationToken);
    }

    public async Task DeleteAsync(long userId, CancellationToken cancellationToken = default)
    {
        var blobPrefix = itemImageStorage.GetUserBlobPrefix(userId);

        var registerEntraDeletion = false;
        byte[]? trialEmailHash = null;
        if (entraOptions.Enabled)
        {
            var identity = await accountDeletionStore.GetExternalIdentityAsync(userId, cancellationToken);
            // Only a user of the configured customer tenant is ever handed to the directory.
            registerEntraDeletion = identity is not null && identity.TenantId == entraOptions.TenantId;
            if (registerEntraDeletion)
            {
                // Best effort and never a reason to refuse the deletion: the person's right to delete comes before anti-abuse bookkeeping.
                try
                {
                    // Settles the account's trial window (when the program is on) so there is a window to remember.
                    await entitlementService.GetForUserAsync(userId, cancellationToken);
                    trialEmailHash = trialIdentityHasher.HashEmail(await entraDirectory.GetSignInEmailAsync(identity!, cancellationToken));
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    trialEmailHash = null;
                }
            }
        }

        // SQL deletion commits together with a durable Blob cleanup task registration (and, when enabled, the Entra deletion
        // task and the trial memory) - same transaction, see AccountDeletionStore - so by the time this call returns, the account
        // is already fully deleted from Juple's perspective, and each follow-up is guaranteed to have its task.
        var result = await accountDeletionStore.DeleteAllDataAsync(
            userId,
            new AccountDeletionPlan(blobPrefix, timeProvider.GetUtcNow(), registerEntraDeletion, trialEmailHash),
            cancellationToken);

        // Best-effort immediate attempts. Neither throws: a failure leaves its durable task for the retry job.
        await blobCleanupService.TryCleanupAsync(result.BlobCleanupTaskId, cancellationToken);
        if (result.EntraDeletionTaskId is { } entraTaskId)
        {
            await entraDeletionService.TryCompleteAsync(entraTaskId, cancellationToken);
        }
    }
}
