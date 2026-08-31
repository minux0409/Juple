using System.Runtime.ExceptionServices;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.BootstrapCurrentUser;

internal static class ExternalIdentityRaceRecovery
{
    internal static async Task RecoverOrRethrowAsync(
        DbUpdateException exception,
        bool isUniqueConstraintViolation,
        Func<CancellationToken, Task> rollbackAsync,
        Action clearChangeTracker,
        Func<CancellationToken, Task<bool>> externalIdentityExistsAsync,
        CancellationToken cancellationToken)
    {
        if (!isUniqueConstraintViolation)
        {
            Rethrow(exception);
        }

        await rollbackAsync(cancellationToken);
        clearChangeTracker();

        if (await externalIdentityExistsAsync(cancellationToken))
        {
            return;
        }

        Rethrow(exception);
    }

    private static void Rethrow(Exception exception)
    {
        ExceptionDispatchInfo.Capture(exception).Throw();
        throw exception;
    }
}