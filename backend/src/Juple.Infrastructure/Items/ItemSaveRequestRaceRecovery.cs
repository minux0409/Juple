using System.Runtime.ExceptionServices;
using Juple.Application.Inbox;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

internal static class ItemSaveRequestRaceRecovery
{
    internal static async Task<InboxEntrySaveResult> RecoverOrRethrowAsync(
        DbUpdateException exception,
        bool isUniqueConstraintViolation,
        string requestedUrl,
        Func<CancellationToken, Task> rollbackTransactionAsync,
        Action clearChangeTracker,
        Func<CancellationToken, Task<InboxEntryDto?>> findExistingAsync,
        CancellationToken cancellationToken)
    {
        if (!isUniqueConstraintViolation)
        {
            Rethrow(exception);
        }

        await rollbackTransactionAsync(cancellationToken);
        clearChangeTracker();

        var existing = await findExistingAsync(cancellationToken);
        if (existing is null)
        {
            Rethrow(exception);
        }

        if (existing!.Url != requestedUrl)
        {
            throw new InboxEntryClientRequestConflictException();
        }

        return new InboxEntrySaveResult(existing, Created: false);
    }

    private static void Rethrow(Exception exception)
    {
        ExceptionDispatchInfo.Capture(exception).Throw();
        throw exception;
    }
}
