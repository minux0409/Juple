namespace Juple.Domain.Billing;

/// <summary>Where an account stands in the post-subscription data retention policy (docs/RELEASE_BACKLOG.md "DATA RETENTION").</summary>
public enum DataRetentionPhase
{
    /// <summary>Never scheduled: the billing program is not running, the policy is not in effect, or there is no ended access to count from (see the reason).</summary>
    NotApplicable,

    /// <summary>Live access (paid, cancelled-but-not-ended, grace period or a running trial): nothing is scheduled.</summary>
    Active,

    /// <summary>The store is still retrying a payment (OnHold) or the person paused the subscription: read-only, but the 6-month clock does not run.</summary>
    BillingHold,

    /// <summary>Access ended: read-only, the 6-month clock runs (from the end of the last paid access, or of the trial - see the basis).</summary>
    ReadOnly,

    /// <summary>6 months after the clock started. ELIGIBLE only - deletion itself needs the feature flag, a dry-run, legal review and operator approval.</summary>
    DeletionDue,
}

public enum DataRetentionNotApplicableReason
{
    None,

    /// <summary>Billing:ProgramEnabled is false (Production today): no account is ever scheduled, whatever its age or trial.</summary>
    ProgramNotRunning,

    /// <summary>No retention effective instant is configured: the policy is not in effect and nobody is scheduled (fail closed).</summary>
    PolicyNotInEffect,

    /// <summary>No ended access to count from: no paid access period and no settled trial (e.g. only a pending purchase).</summary>
    NoAccessHistory,

    /// <summary>Trial only, and the account was created before the policy took effect: the policy is never applied retroactively to it.</summary>
    TrialBeforePolicy,
}

/// <summary>What the 6-month clock counts from.</summary>
public enum DataRetentionBasis
{
    None,

    /// <summary>The latest end of a paid access period (never earlier than the policy's effective instant).</summary>
    PaidAccessEnded,

    /// <summary>The trial end of an account created at or after the policy's effective instant that never had paid access.</summary>
    TrialEnded,
}

/// <summary>The notice that is due now (each is sent once; the sender records which notices went out).</summary>
public enum DataRetentionNotice
{
    None,

    /// <summary>3 months after the clock started: "보관 기간이 곧 끝납니다".</summary>
    RetentionEnding,

    /// <summary>5 months after: "곧 삭제될 예정입니다" with the deletion date.</summary>
    DeletionScheduled,

    /// <summary>7 days before the deletion date: the final notice.</summary>
    FinalNotice,
}

/// <summary>The account facts the policy reads (instants are compared as UTC).</summary>
/// <param name="ProgramEnabled">Billing:ProgramEnabled. Off (Production today) = nobody is ever scheduled.</param>
/// <param name="PolicyEffectiveAtUtc">When the retention policy took effect (as published in the terms). Null = not in effect.</param>
/// <param name="AccountCreatedAtUtc">The account's creation instant: decides whether a trial-only account is covered.</param>
/// <param name="TrialEndsAtUtc">The settled trial end (users.Users.TrialEndsAtUtc); null when no trial was settled.</param>
/// <param name="Purchases">Every verified store purchase of the account.</param>
public sealed record DataRetentionInput(
    bool ProgramEnabled,
    DateTimeOffset? PolicyEffectiveAtUtc,
    DateTimeOffset AccountCreatedAtUtc,
    DateTimeOffset? TrialEndsAtUtc,
    IReadOnlyCollection<PurchaseAccess> Purchases);

public sealed record DataRetentionState(
    DataRetentionPhase Phase,
    DataRetentionNotApplicableReason NotApplicableReason,
    DataRetentionBasis Basis,
    DateTimeOffset? RetentionStartedAtUtc,
    DateTimeOffset? RetentionEndingNoticeAtUtc,
    DateTimeOffset? DeletionScheduledNoticeAtUtc,
    DateTimeOffset? FinalNoticeAtUtc,
    DateTimeOffset? DeletionDueAtUtc,
    DataRetentionNotice DueNotice);

/// <summary>
/// The post-subscription data retention policy as a PURE function of the billing state - no I/O, no clock of its own, the same
/// answer for the same inputs (so a job can re-evaluate it any number of times). It never deletes anything; it only says which
/// phase an account is in and when each notice and the deletion would be due.
///
/// Rules (all instants UTC; months are calendar months added to the instant):
/// - The program is off -> NotApplicable. Sign-up date and trial never count on their own.
/// - No policy effective instant -> NotApplicable (fail closed): turning the program on starts no clock by itself.
/// - Any live access (a live paid purchase, Canceled until its paid period ends, a grace period, or a running trial) -> Active.
/// - A payment being retried (OnHold) or a paused subscription -> BillingHold: the clock is not started while the store may still recover.
/// - Paid access existed -> the clock starts at the LATEST end of paid access (refund / revocation included: its end is when access
///   ended), but never before the policy took effect - an earlier end counts from the effective instant (nothing is retroactive).
/// - Trial only -> the clock starts at the trial end ONLY for an account created at or after the effective instant. An account that
///   already existed is never scheduled for its trial alone (TrialBeforePolicy); it is covered once it pays and that access ends.
/// - Otherwise (pending only, no settled trial) -> NotApplicable (NoAccessHistory).
/// - +3 months RetentionEnding, +5 months DeletionScheduled, deletion - 7 days FinalNotice, +6 months DeletionDue.
///   Re-subscribing is live access again -> Active; a later expiry starts a new, later clock.
/// </summary>
public static class DataRetentionPolicy
{
    public const int RetentionMonths = 6;
    public const int RetentionEndingNoticeMonths = 3;
    public const int DeletionScheduledNoticeMonths = 5;
    public static readonly TimeSpan FinalNoticeBeforeDeletion = TimeSpan.FromDays(7);

    public static DataRetentionState Evaluate(DataRetentionInput input, DateTimeOffset nowUtc)
    {
        ArgumentNullException.ThrowIfNull(input);
        var now = nowUtc.ToUniversalTime();
        if (!input.ProgramEnabled)
        {
            return NotApplicable(DataRetentionNotApplicableReason.ProgramNotRunning);
        }

        if (input.PolicyEffectiveAtUtc is null)
        {
            return NotApplicable(DataRetentionNotApplicableReason.PolicyNotInEffect);
        }

        var effectiveAt = input.PolicyEffectiveAtUtc.Value.ToUniversalTime();
        var trialEnd = input.TrialEndsAtUtc?.ToUniversalTime();
        var purchases = input.Purchases;
        if ((trialEnd is not null && now < trialEnd.Value) || purchases.Any(purchase => purchase.IsLiveAt(now)))
        {
            return Simple(DataRetentionPhase.Active);
        }

        if (purchases.Any(purchase => purchase.State is StorePurchaseState.OnHold or StorePurchaseState.Paused))
        {
            return Simple(DataRetentionPhase.BillingHold);
        }

        // A paid access period existed when the store reported an access end for a purchase that was not merely pending.
        var paidEnds = purchases
            .Where(purchase => purchase.State is not StorePurchaseState.Pending && purchase.AccessEndsAtUtc is not null)
            .Select(purchase => purchase.AccessEndsAtUtc!.Value.ToUniversalTime())
            .ToList();
        if (paidEnds.Count > 0)
        {
            var paidEnd = paidEnds.Max();
            return Scheduled(DataRetentionBasis.PaidAccessEnded, paidEnd > effectiveAt ? paidEnd : effectiveAt, now);
        }

        if (trialEnd is null)
        {
            return NotApplicable(DataRetentionNotApplicableReason.NoAccessHistory);
        }

        return input.AccountCreatedAtUtc.ToUniversalTime() >= effectiveAt
            ? Scheduled(DataRetentionBasis.TrialEnded, trialEnd.Value, now)
            : NotApplicable(DataRetentionNotApplicableReason.TrialBeforePolicy);
    }

    /// <summary>The next notice instant strictly after <paramref name="nowUtc"/> (3 months, 5 months, deletion - 7 days), or null when none is left.</summary>
    public static DateTimeOffset? NextNoticeAtUtc(DataRetentionState state, DateTimeOffset nowUtc)
    {
        ArgumentNullException.ThrowIfNull(state);
        var now = nowUtc.ToUniversalTime();
        foreach (var instant in new[] { state.RetentionEndingNoticeAtUtc, state.DeletionScheduledNoticeAtUtc, state.FinalNoticeAtUtc })
        {
            if (instant is { } at && at > now)
            {
                return at;
            }
        }

        return null;
    }

    private static DataRetentionState Scheduled(DataRetentionBasis basis, DateTimeOffset start, DateTimeOffset now)
    {
        var ending = start.AddMonths(RetentionEndingNoticeMonths);
        var scheduled = start.AddMonths(DeletionScheduledNoticeMonths);
        var deletion = start.AddMonths(RetentionMonths);
        var final = deletion - FinalNoticeBeforeDeletion;
        var due = now >= final ? DataRetentionNotice.FinalNotice
            : now >= scheduled ? DataRetentionNotice.DeletionScheduled
            : now >= ending ? DataRetentionNotice.RetentionEnding
            : DataRetentionNotice.None;
        var phase = now >= deletion ? DataRetentionPhase.DeletionDue : DataRetentionPhase.ReadOnly;
        return new DataRetentionState(phase, DataRetentionNotApplicableReason.None, basis, start, ending, scheduled, final, deletion, due);
    }

    private static DataRetentionState NotApplicable(DataRetentionNotApplicableReason reason) =>
        new(DataRetentionPhase.NotApplicable, reason, DataRetentionBasis.None, null, null, null, null, null, DataRetentionNotice.None);

    private static DataRetentionState Simple(DataRetentionPhase phase) =>
        new(phase, DataRetentionNotApplicableReason.None, DataRetentionBasis.None, null, null, null, null, null, DataRetentionNotice.None);
}
