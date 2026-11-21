namespace Juple.Domain.Billing;

/// <summary>One official membership trial per identity or email hash. Separate from historical test trials; survives account deletion.</summary>
public sealed class MembershipTrialLedgerEntry
{
    private MembershipTrialLedgerEntry()
    {
    }

    public MembershipTrialLedgerEntry(byte[] identityHash, DateTimeOffset trialStartedAtUtc, DateTimeOffset trialEndsAtUtc, DateTimeOffset createdAtUtc)
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
