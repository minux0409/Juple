namespace Juple.Domain.Billing;

/// <summary>Where a purchase was made. Persisted as a stable string. (App Store arrives with R39-C.)</summary>
public enum StoreSource
{
    GooglePlay,
}

/// <summary>
/// A store-neutral normalization of what the store last told us about ONE purchase (never a Google/Apple enum leaking out).
/// Persisted as a stable string. Live access is decided by <see cref="PurchaseAccess"/>, not by this name alone.
/// </summary>
public enum StorePurchaseState
{
    /// <summary>Awaiting payment: no entitlement, never acknowledged.</summary>
    Pending,

    /// <summary>Paid and current.</summary>
    Active,

    /// <summary>A renewal payment failed; the store still grants access while it retries.</summary>
    GracePeriod,

    /// <summary>Cancelled (auto-renew off) but the paid period has not ended: access continues until it does.</summary>
    Canceled,

    /// <summary>Payment failed beyond the grace period: access suspended while the store keeps retrying.</summary>
    OnHold,

    /// <summary>The user paused the subscription: no access while paused.</summary>
    Paused,

    /// <summary>The paid period ended (or the pending purchase was cancelled).</summary>
    Expired,

    /// <summary>Revoked by the developer or the system (refund / chargeback): access ended.</summary>
    Revoked,
}

/// <summary>
/// One store purchase (a Google Play purchase token, later an Apple original transaction), linked to AT MOST one Juple
/// account. The token itself is never stored in the clear: <see cref="ExternalKeyHash"/> (SHA-256) identifies it and is
/// unique per source - so one token can never belong to two accounts - while <see cref="VerificationHandleEncrypted"/> holds
/// it AES-256-GCM sealed under a dedicated billing key, because periodic reconciliation must call the store again later.
///
/// <see cref="UserId"/> is nullable on purpose: deleting a Juple account does not cancel a store subscription, so the purchase
/// is DETACHED (UserId null, <see cref="DetachedAtUtc"/> set) rather than deleted - keeping only the identity needed to stop
/// token reuse and to allow a verified restore. No profile, email or Juple ID is kept. Retention (working policy, see
/// RetentionOptions and docs/data-retention.md): the sealed handle goes 180 days after access ended, the rest of the row (hash +
/// minimal state) at most 5 years after - the 5 years is a legal/accounting-review item, not a final value.
/// </summary>
public sealed class StorePurchase
{
    private StorePurchase()
    {
    }

    public StorePurchase(
        long? userId,
        StoreSource source,
        string productId,
        byte[] externalKeyHash,
        byte[] verificationHandleEncrypted,
        DateTimeOffset nowUtc)
    {
        UserId = userId;
        Source = source;
        ProductId = productId;
        ExternalKeyHash = externalKeyHash;
        VerificationHandleEncrypted = verificationHandleEncrypted;
        FirstLinkedAtUtc = nowUtc;
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
        LatestVerifiedAtUtc = nowUtc;
        NextReconcileAtUtc = nowUtc;
        State = StorePurchaseState.Pending;
        Reason = EntitlementReason.None;
    }

    public long Id { get; private set; }

    public long? UserId { get; private set; }

    public StoreSource Source { get; private set; }

    public string ProductId { get; private set; } = null!;

    public string? BasePlanId { get; private set; }

    /// <summary>SHA-256 of the store's purchase handle (Google: the purchase token). Unique with <see cref="Source"/>.</summary>
    public byte[] ExternalKeyHash { get; private set; } = [];

    /// <summary>
    /// The purchase handle, AES-256-GCM sealed (see IPurchaseTokenProtector). Never logged, never returned. NULL once the retention
    /// cleanup has removed it (<see cref="VerificationHandlePurgedAtUtc"/>), which only ever happens to a purchase whose access ended
    /// long ago: the row, its <see cref="ExternalKeyHash"/> and its state stay, so a token can still never be linked twice, and a
    /// verify / restore / store notification that presents the token itself needs nothing from the database for it. Only the
    /// periodic re-check of the stored token ends - and an ended purchase has nothing left to re-check.
    /// </summary>
    public byte[]? VerificationHandleEncrypted { get; private set; } = [];

    /// <summary>When the retention cleanup removed the sealed handle (see <see cref="VerificationHandleEncrypted"/>); null while it is kept.</summary>
    public DateTimeOffset? VerificationHandlePurgedAtUtc { get; private set; }

    public StorePurchaseState State { get; private set; }

    public EntitlementReason Reason { get; private set; }

    public DateTimeOffset? CurrentPeriodStartUtc { get; private set; }

    /// <summary>
    /// The instant live access ends (while live) or ended (once not): the store's expiry for an active or cancelled
    /// subscription, a short re-verification horizon for a grace period (the store does not document its end), and a stable
    /// earliest-known end once access has lapsed. Null only for a purchase that never granted access. Never "now" of a request.
    /// </summary>
    public DateTimeOffset? AccessEndsAtUtc { get; private set; }

    public bool? AutoRenews { get; private set; }

    /// <summary>The store still needs this new purchase acknowledged (it refunds unacknowledged purchases after about 3 days).</summary>
    public bool AcknowledgementPending { get; private set; }

    public DateTimeOffset? AcknowledgedAtUtc { get; private set; }

    public DateTimeOffset LatestVerifiedAtUtc { get; private set; }

    /// <summary>When the reconciliation job should ask the store about this purchase again (a bounded cadence, not a hot loop).</summary>
    public DateTimeOffset NextReconcileAtUtc { get; private set; }

    public DateTimeOffset FirstLinkedAtUtc { get; private set; }

    public DateTimeOffset? DetachedAtUtc { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>Applies a fresh authoritative normalization. A lapsed purchase keeps its EARLIEST known end so the freeze instant never drifts.</summary>
    public void ApplyVerified(NormalizedPurchase normalized, string? basePlanId, DateTimeOffset? periodStartUtc, DateTimeOffset nowUtc)
    {
        var wasLapsed = State is StorePurchaseState.OnHold or StorePurchaseState.Paused or StorePurchaseState.Expired or StorePurchaseState.Revoked;
        var nowLapsed = normalized.State is StorePurchaseState.OnHold or StorePurchaseState.Paused or StorePurchaseState.Expired or StorePurchaseState.Revoked;
        var end = normalized.AccessEndsAtUtc;
        if (wasLapsed && nowLapsed && AccessEndsAtUtc is { } previous && (end is null || previous < end))
        {
            end = previous;
        }

        State = normalized.State;
        Reason = normalized.Reason;
        AccessEndsAtUtc = end;
        AutoRenews = normalized.AutoRenews;
        BasePlanId = basePlanId;
        CurrentPeriodStartUtc = periodStartUtc;
        AcknowledgementPending = normalized.AcknowledgementPending;
        NextReconcileAtUtc = normalized.NextReconcileAtUtc;
        LatestVerifiedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>
    /// A token was presented again for a row whose sealed handle the retention cleanup had removed: keep it from now on, so a purchase
    /// that turns out to be live is reconciled like any other. A row that still has its handle is left exactly as it is.
    /// </summary>
    public void RestoreVerificationHandle(byte[] sealedHandle)
    {
        if (VerificationHandleEncrypted is null)
        {
            VerificationHandleEncrypted = sealedHandle;
            VerificationHandlePurgedAtUtc = null;
        }
    }

    public void MarkAcknowledged(DateTimeOffset nowUtc)
    {
        AcknowledgementPending = false;
        AcknowledgedAtUtc ??= nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>A verified restore by an account that presented the token: the purchase now belongs to it.</summary>
    public void LinkTo(long userId, DateTimeOffset nowUtc)
    {
        UserId = userId;
        DetachedAtUtc = null;
        UpdatedAtUtc = nowUtc;
    }
}

/// <summary>What one store purchase means for access - the only thing the entitlement calculation reads.</summary>
public sealed record PurchaseAccess(StorePurchaseState State, EntitlementReason Reason, DateTimeOffset? AccessEndsAtUtc)
{
    /// <summary>Live while the state grants access and the end instant has not been reached.</summary>
    public bool IsLiveAt(DateTimeOffset nowUtc) =>
        State is StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled
        && AccessEndsAtUtc is { } end
        && nowUtc < end;
}

/// <summary>The store-neutral result of normalizing one authoritative store response (see GooglePurchaseNormalizer).</summary>
public sealed record NormalizedPurchase(
    StorePurchaseState State,
    EntitlementReason Reason,
    DateTimeOffset? AccessEndsAtUtc,
    bool? AutoRenews,
    bool AcknowledgementPending,
    DateTimeOffset NextReconcileAtUtc);
