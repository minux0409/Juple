using Juple.Application.Identity;
using Juple.Application.Users.DeleteAccount;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Users.DeleteAccount;

public sealed class EntraIdentityDeletionService(
    IEntraIdentityDeletionStore store,
    IEntraIdentityDirectory directory,
    TimeProvider timeProvider,
    ILogger<EntraIdentityDeletionService> logger) : IEntraIdentityDeletionService
{
    private const int BatchLimit = 50;

    public async Task<bool> TryCompleteAsync(long taskId, CancellationToken cancellationToken = default)
    {
        try
        {
            var task = await store.FindAsync(taskId, cancellationToken);
            if (task is null)
            {
                return true;
            }

            try
            {
                var outcome = await directory.DeleteUserAsync(new ExternalIdentityPrincipal(task.TenantId, task.ObjectId), cancellationToken);
                await store.CompleteAsync(taskId, cancellationToken);
                logger.LogInformation("account.entra-deletion.completed Outcome={Outcome}", outcome);
                return true;
            }
            catch (EntraDirectoryException exception)
            {
                await store.RecordFailureAsync(taskId, exception.Code, timeProvider.GetUtcNow(), cancellationToken);
                logger.LogWarning("account.entra-deletion.failed Code={Code}", exception.Code);
                return false;
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Never lets a bookkeeping failure turn an already committed account deletion into an error for the caller.
            logger.LogWarning("account.entra-deletion.error Type={Type}", exception.GetType().Name);
            return false;
        }
    }

    public async Task<EntraDeletionRunResult> RunPendingAsync(CancellationToken cancellationToken = default)
    {
        var ids = await store.ListPendingIdsAsync(BatchLimit, cancellationToken);
        var succeeded = 0;
        foreach (var id in ids)
        {
            if (await TryCompleteAsync(id, cancellationToken))
            {
                succeeded++;
            }
        }

        return new EntraDeletionRunResult(ids.Count, succeeded, ids.Count - succeeded);
    }

    public async Task<bool> IsStillPendingAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default)
    {
        var task = await store.FindForIdentityAsync(identity, cancellationToken);
        if (task is null)
        {
            return false;
        }

        return !await TryCompleteAsync(task.Id, cancellationToken);
    }
}
