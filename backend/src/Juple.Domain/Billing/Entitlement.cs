namespace Juple.Domain.Billing;

/// <summary>The access state shown to people. Only these four - store-specific detail stays internal.</summary>
public enum EntitlementStatus
{
    Trial,
    Active,
    GracePeriod,
    Expired,
}

/// <summary>
/// Why an entitlement is in its status. Only ever changes copy, never access - access is decided by
/// <see cref="Entitlement.CanWrite"/> alone.
/// </summary>
public enum EntitlementReason
{
    None,
    Cancelled,
    BillingIssue,
    Refunded,
}

/// <summary>The account's 30-day free window (see <see cref="TrialPolicy"/>). Both ends are UTC instants.</summary>
public readonly record struct TrialWindow(DateTimeOffset StartedAtUtc, DateTimeOffset EndsAtUtc);

/// <summary>
/// The effective access of ONE account at one instant - an immutable result, always computed from server time.
///
/// While the subscription program is not launched (<see cref="ProgramEnabled"/> false) nobody is restricted and
/// no status is claimed: <see cref="Status"/> is null and <see cref="CanWrite"/> is true. That is deliberately not
/// "Active" - it must never be mistaken for a paying subscriber.
///
/// <see cref="AccessFrozenAtUtc"/> is the stable instant live access ended, and only exists while Expired. It is
/// never "now": it must not move between requests, because shared-Collection reads later use it as the boundary of
/// what an expired member may still see (see EntitlementAccessPolicy).
///
/// No store token, transaction id or identity hash is ever part of this type.
/// </summary>
public sealed record Entitlement
{
    private Entitlement()
    {
    }

    public bool ProgramEnabled { get; private init; }

    public EntitlementStatus? Status { get; private init; }

    public EntitlementReason? Reason { get; private init; }

    public DateTimeOffset? TrialStartedAtUtc { get; private init; }

    public DateTimeOffset? TrialEndsAtUtc { get; private init; }

    public DateTimeOffset? CurrentPeriodEndsAtUtc { get; private init; }

    public DateTimeOffset VerifiedAtUtc { get; private init; }

    public bool CanWrite { get; private init; }

    public DateTimeOffset? AccessFrozenAtUtc { get; private init; }

    /// <summary>The program is not launched: today's behavior, nothing restricted, no status claimed.</summary>
    public static Entitlement NotLaunched(DateTimeOffset verifiedAtUtc) =>
        new() { ProgramEnabled = false, CanWrite = true, VerifiedAtUtc = verifiedAtUtc };

    /// <summary>The trial window evaluated at <paramref name="nowUtc"/>: live until the exact end instant, Expired from it on.</summary>
    public static Entitlement ForTrial(TrialWindow window, DateTimeOffset nowUtc) =>
        nowUtc < window.EndsAtUtc
            ? new()
            {
                ProgramEnabled = true,
                Status = EntitlementStatus.Trial,
                Reason = EntitlementReason.None,
                TrialStartedAtUtc = window.StartedAtUtc,
                TrialEndsAtUtc = window.EndsAtUtc,
                CanWrite = true,
                VerifiedAtUtc = nowUtc,
            }
            : Expired(window, window.EndsAtUtc, EntitlementReason.None, nowUtc);

    /// <summary>Expired, with the authoritative instant live access ended (the trial end, or later a verified paid end).</summary>
    public static Entitlement Expired(TrialWindow? window, DateTimeOffset accessFrozenAtUtc, EntitlementReason reason, DateTimeOffset verifiedAtUtc) =>
        new()
        {
            ProgramEnabled = true,
            Status = EntitlementStatus.Expired,
            Reason = reason,
            TrialStartedAtUtc = window?.StartedAtUtc,
            TrialEndsAtUtc = window?.EndsAtUtc,
            CanWrite = false,
            AccessFrozenAtUtc = accessFrozenAtUtc,
            VerifiedAtUtc = verifiedAtUtc,
        };

    /// <summary>
    /// A verified paid period (Active) or a grace period after a failed renewal (GracePeriod). Not reachable yet - the
    /// store integrations (R39-B/R39-C) are what will call it; it exists so the contract and its semantics are fixed now.
    /// </summary>
    public static Entitlement Paid(EntitlementStatus status, DateTimeOffset periodEndsAtUtc, EntitlementReason reason, TrialWindow? window, DateTimeOffset verifiedAtUtc)
    {
        if (status is not (EntitlementStatus.Active or EntitlementStatus.GracePeriod))
        {
            throw new ArgumentOutOfRangeException(nameof(status), status, "Only Active or GracePeriod is a paid, live state.");
        }

        return new()
        {
            ProgramEnabled = true,
            Status = status,
            Reason = reason,
            TrialStartedAtUtc = window?.StartedAtUtc,
            TrialEndsAtUtc = window?.EndsAtUtc,
            CurrentPeriodEndsAtUtc = periodEndsAtUtc,
            CanWrite = true,
            VerifiedAtUtc = verifiedAtUtc,
        };
    }
}
