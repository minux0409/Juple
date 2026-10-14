namespace Juple.Domain.Users;

/// <summary>
/// A durable record that the Microsoft Entra External ID sign-in account of a deleted Juple account still has to be
/// deleted. Written in the SAME SQL transaction as the account's data deletion (see AccountDeletionStore), so a committed
/// deletion always has one - Entra and SQL cannot share a transaction, and deleting Entra first could strand the data of
/// a person who can then no longer sign in to retry.
///
/// Carries only the two directory ids needed to finish the job (no email, name, Juple id or token) and exists only until
/// Entra confirms the user is gone (deleted, or already not found); the row is then removed. While it exists, a new Juple
/// account for the same identity is refused (see CurrentUserBootstrapService).
/// </summary>
public sealed class PendingEntraIdentityDeletion
{
    private PendingEntraIdentityDeletion()
    {
    }

    public PendingEntraIdentityDeletion(Guid tenantId, Guid objectId, DateTimeOffset createdAtUtc)
    {
        TenantId = tenantId;
        ObjectId = objectId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid ObjectId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset? LastAttemptAtUtc { get; private set; }

    /// <summary>A sanitized code (an HTTP status or exception type name) - never a raw message or directory content.</summary>
    public string? LastErrorCode { get; private set; }

    public void RecordFailedAttempt(string? errorCode, DateTimeOffset attemptedAtUtc)
    {
        AttemptCount++;
        LastAttemptAtUtc = attemptedAtUtc;
        LastErrorCode = errorCode;
    }
}
