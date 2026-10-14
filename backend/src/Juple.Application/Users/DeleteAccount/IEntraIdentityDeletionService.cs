using Juple.Application.Identity;

namespace Juple.Application.Users.DeleteAccount;

public sealed record EntraDeletionRunResult(int Pending, int Succeeded, int Failed);

public interface IEntraIdentityDeletionService
{
    /// <summary>Tries once to finish one pending deletion. Never throws: a failure is recorded and the row stays for the retry job.</summary>
    Task<bool> TryCompleteAsync(long taskId, CancellationToken cancellationToken = default);

    /// <summary>The retry job's entry point: a bounded pass over every pending deletion (idempotent - "already gone" counts as done).</summary>
    Task<EntraDeletionRunResult> RunPendingAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// True while the identity still has an unfinished deletion. Used before creating a Juple account: the old sign-in
    /// account must be gone first, otherwise the deleted person could sign straight back in with the old password.
    /// Tries to finish it first, so a transient failure that has since cleared does not block a real new sign-up.
    /// </summary>
    Task<bool> IsStillPendingAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default);
}

