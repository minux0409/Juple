namespace Juple.Domain.Billing;

/// <summary>
/// The free-trial rule - a fixed product decision, so it lives here as policy and is not a setting: exactly
/// 30 * 24 hours of UTC time (never "one calendar month", never device time).
///
/// When the subscription program starts at <c>programStartAtUtc</c>:
///   an account created BEFORE it   -> trial = programStart .. programStart + 30 days (its fresh 30 days)
///   an account created AT/AFTER it -> trial = createdAt    .. createdAt    + 30 days
/// so shipping this code does not consume anybody's trial.
/// </summary>
public static class TrialPolicy
{
    public const int DurationDays = 30;

    public static readonly TimeSpan Duration = TimeSpan.FromHours(DurationDays * 24);

    public static TrialWindow WindowFor(DateTimeOffset userCreatedAtUtc, DateTimeOffset programStartAtUtc)
    {
        var createdAt = userCreatedAtUtc.ToUniversalTime();
        var programStart = programStartAtUtc.ToUniversalTime();
        var start = createdAt < programStart ? programStart : createdAt;
        return new TrialWindow(start, start + Duration);
    }

    /// <summary>How far a fresh window's start may differ from the account's creation instant (a database round trip of the same value).</summary>
    private static readonly TimeSpan FreshWindowTolerance = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Whether the request that created an account also gave it its OWN, fresh free period - the one fact the apps' first-run welcome
    /// ("your first month is free") may rely on. False for an account created before the program starts (its window begins at the
    /// program start), for a re-created account that was given back its earlier window through the trial ledger, while the program is
    /// off (no trial exists), and for anything not in a running trial.
    /// </summary>
    public static bool GrantedFreshTrial(bool accountCreated, Entitlement entitlement, DateTimeOffset accountCreatedAtUtc) =>
        accountCreated
        && entitlement.ProgramEnabled
        && entitlement.Status == EntitlementStatus.Trial
        && entitlement.TrialStartedAtUtc is { } started
        && (started - accountCreatedAtUtc).Duration() <= FreshWindowTolerance;
}
