using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;

namespace Juple.Application.Users.DeleteAccount;

public sealed class DeleteAccountService(
    IAccountDeletionStore accountDeletionStore,
    IItemImageStorage itemImageStorage,
    IBlobCleanupService blobCleanupService,
    TimeProvider timeProvider) : IDeleteAccountService
{
    public async Task DeleteAsync(long userId, CancellationToken cancellationToken = default)
    {
        var blobPrefix = itemImageStorage.GetUserBlobPrefix(userId);

        // SQL deletion commits together with a durable Blob cleanup task registration (same
        // transaction - see AccountDeletionStore) - by the time this call returns, the account is
        // already fully deleted from Juple's perspective, and a cleanup task is guaranteed to
        // exist for its Blobs regardless of what happens next.
        var cleanupTaskId = await accountDeletionStore.DeleteAllDataAsync(
            userId, blobPrefix, timeProvider.GetUtcNow(), cancellationToken);

        // Best-effort immediate attempt. Never throws: if this fails, the durable task created
        // above means nothing is lost - IBlobCleanupService.RunPendingCleanupsAsync (the
        // maintenance/retry entry point) picks it up later. The account deletion itself must never
        // wait on or fail because of this.
        await blobCleanupService.TryCleanupAsync(cleanupTaskId, cancellationToken);
    }
}
