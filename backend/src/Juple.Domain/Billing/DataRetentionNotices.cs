using System.Globalization;

namespace Juple.Domain.Billing;

/// <summary>
/// When a retention notice is sent and when a deletion would be allowed - pure rules, so the (future, not yet built) notice job and
/// deletion job cannot drift from them. Nothing here sends or deletes anything.
///
/// Notices are recorded as ordinary inbox <c>Notification</c> rows (the existing Notifications/Push pipeline); their
/// <see cref="DedupKey"/> - unique per account, retention period and notice - makes a rerun, a second job instance or a retry insert
/// nothing twice (the Notifications table's filtered unique index on DedupKey). A re-subscription makes the account Active, so nothing
/// further is due; a later expiry is a NEW period (another start instant), whose notices have new keys.
/// </summary>
public static class DataRetentionNotices
{
    /// <summary>The final notice must have reached the person at least this long before anything may be deleted.</summary>
    public static readonly TimeSpan MinimumFinalNoticeLead = DataRetentionPolicy.FinalNoticeBeforeDeletion;

    /// <summary>
    /// The one notice to send now, given the notices already sent for this period: only the LATEST one that is due, and never one that
    /// is older than a notice already sent (a job that was down for months sends the current notice, not a backlog of stale ones).
    /// Nothing while live, on billing hold, or not scheduled.
    /// </summary>
    public static DataRetentionNotice ToSend(DataRetentionState state, IReadOnlyCollection<DataRetentionNotice> alreadySentThisPeriod)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(alreadySentThisPeriod);
        if (state.Phase is not (DataRetentionPhase.ReadOnly or DataRetentionPhase.DeletionDue) || state.DueNotice == DataRetentionNotice.None)
        {
            return DataRetentionNotice.None;
        }

        return alreadySentThisPeriod.Any(sent => sent >= state.DueNotice) ? DataRetentionNotice.None : state.DueNotice;
    }

    /// <summary>The idempotency key of one notice: account, retention period (its start instant) and which notice.</summary>
    public static string DedupKey(long userId, DateTimeOffset retentionStartedAtUtc, DataRetentionNotice notice)
    {
        if (notice == DataRetentionNotice.None)
        {
            throw new ArgumentOutOfRangeException(nameof(notice), "There is no key for 'no notice'.");
        }

        return string.Create(
            CultureInfo.InvariantCulture,
            $"retention:{userId}:{retentionStartedAtUtc.UtcTicks}:{(int)notice}");
    }

    /// <summary>
    /// Whether the account's content may be deleted NOW under the policy: it must be DeletionDue AND the final notice must have been sent
    /// for THIS period at least <see cref="MinimumFinalNoticeLead"/> ago. A person who never got the final notice is never deleted - the
    /// deletion simply waits. This is necessary, not sufficient: the (future) deletion job additionally needs its feature flag, a dry-run,
    /// legal sign-off and operator approval, none of which exists in this build.
    /// </summary>
    public static bool DeletionMayProceed(DataRetentionState state, DateTimeOffset? finalNoticeSentAtUtc, DateTimeOffset nowUtc)
    {
        ArgumentNullException.ThrowIfNull(state);
        return state.Phase == DataRetentionPhase.DeletionDue
            && finalNoticeSentAtUtc is { } sentAt
            && state.RetentionStartedAtUtc is { } start
            && sentAt.ToUniversalTime() >= start
            && nowUtc.ToUniversalTime() - sentAt.ToUniversalTime() >= MinimumFinalNoticeLead;
    }
}
