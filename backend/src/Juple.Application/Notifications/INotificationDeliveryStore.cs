using Juple.Domain.Notifications;
using Juple.Domain.Push;

namespace Juple.Application.Notifications;

public interface INotificationDeliveryStore
{
    /// <summary>
    /// Every (unread Notification, enabled PushDeviceRegistration) pair for userId that is not yet
    /// Sent - a coarse candidate list, not a claim. Deliberately includes Sending pairs too: a
    /// Sending row might be stale (its claimer crashed before recording a final outcome) and
    /// reclaimable, and only TryClaimAsync's own lease check can tell a stale claim apart from a
    /// fresh, genuinely in-progress one - excluding Sending here would make crash recovery
    /// unreachable. The caller must still call TryClaimAsync for each pair immediately before
    /// sending; a candidate returned here can already be claimed by a concurrent dispatch pass by
    /// the time this caller gets to it; TryClaimAsync, not this method, is what makes send-once safe
    /// under concurrency (see its own remarks). Restricted to unread Notifications so a row the user
    /// already read in-app (including one materialized before Push existed at all) is never
    /// retroactively pushed.
    /// </summary>
    Task<IReadOnlyList<(Notification Notification, PushDeviceRegistration Device)>> GetPendingAsync(
        long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atomically transitions this (notificationId, pushDeviceRegistrationId) pair into Sending and
    /// returns true - but only if no NotificationDelivery row exists for it yet, the existing one is
    /// Failed, or the existing one is Sending with a stale (expired) lease, meaning its previous
    /// claimer most likely crashed between claiming and recording a final outcome (see
    /// NotificationDelivery's own remarks on why this, not strict exactly-once, is the goal: a
    /// crashed claim must eventually be retried, at the accepted cost that if the previous claimer
    /// had actually already sent successfully and only crashed before recording it, the retry sends
    /// a duplicate - practical at-least-once, never permanent loss). Returns false without changing
    /// anything if the row is already Sending with a live lease (another dispatch pass currently
    /// owns it) or already Sent - the caller must skip sending in that case.
    ///
    /// This, not GetPendingAsync's candidate list, is the actual concurrency guard: the "no row
    /// exists" case is claimed via an insert that a unique-constraint race safely resolves to at most
    /// one winner (mirrors NotificationStore.MaterializeDueAsync's identical pattern), and the
    /// "existing Failed or stale-Sending row" case is claimed via a single conditional UPDATE whose
    /// affected-row count (0 or 1) is the atomic decision - never a separate read followed by a
    /// write, so two callers racing on the same stale row can never both win.
    /// </summary>
    Task<bool> TryClaimAsync(
        long notificationId, long pushDeviceRegistrationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the final outcome of a send this caller already successfully claimed via
    /// TryClaimAsync - updates that same claimed row from Sending to its final Sent/Failed status.
    /// </summary>
    Task RecordAttemptAsync(
        long notificationId,
        long pushDeviceRegistrationId,
        NotificationDeliveryStatus status,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode,
        CancellationToken cancellationToken = default);
}
