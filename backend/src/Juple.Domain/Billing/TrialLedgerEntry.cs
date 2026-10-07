namespace Juple.Domain.Billing;

/// <summary>
/// Remembers that an external identity has already been given its free trial, so deleting a Juple account and signing in
/// again (which creates a NEW internal UserId for the same Entra identity) cannot restart the 30 days.
///
/// It stores ONLY a keyed hash of the stable external identity (see ITrialIdentityHasher) and the trial window - never an
/// email, name, Juple ID, raw tenant/object id or token. It deliberately has NO foreign key to Users and survives account
/// deletion; that is its whole purpose.
///
/// A keyed hash is not asserted to be anonymous data. Its retention period and its privacy-policy disclosure must be
/// decided and reviewed before the subscription program launches in Production (see docs/architecture.md).
/// </summary>
public sealed class TrialLedgerEntry
{
    private TrialLedgerEntry()
    {
    }

    public TrialLedgerEntry(byte[] identityHash, DateTimeOffset trialStartedAtUtc, DateTimeOffset trialEndsAtUtc, DateTimeOffset createdAtUtc)
    {
        IdentityHash = identityHash;
        TrialStartedAtUtc = trialStartedAtUtc;
        TrialEndsAtUtc = trialEndsAtUtc;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    /// <summary>HMAC-SHA256 over the external identity (32 bytes). Unique.</summary>
    public byte[] IdentityHash { get; private set; } = [];

    public DateTimeOffset TrialStartedAtUtc { get; private set; }

    public DateTimeOffset TrialEndsAtUtc { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
