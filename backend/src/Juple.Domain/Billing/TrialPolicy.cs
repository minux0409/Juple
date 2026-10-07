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
}
