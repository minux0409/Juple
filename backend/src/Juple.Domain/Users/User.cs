namespace Juple.Domain.Users;

public sealed class User
{
    private User()
    {
    }

    // plan defaults to Free so the ~30 existing call sites across tests (none of which care about
    // entitlement) don't all need updating just to keep compiling - CurrentUserProvisioningStore
    // (the only production call site) still always passes it explicitly.
    public User(
        string preferredLocale,
        string timeZoneId,
        string? defaultCurrencyCode,
        DateTimeOffset createdAtUtc,
        DateTimeOffset updatedAtUtc,
        UserPlan plan = UserPlan.Free)
    {
        PreferredLocale = preferredLocale;
        TimeZoneId = timeZoneId;
        DefaultCurrencyCode = defaultCurrencyCode;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = updatedAtUtc;
        Plan = plan;
        PublicCode = UserPublicCode.Generate();
    }

    public long Id { get; private set; }

    /// <summary>The public "Juple ID" (see UserPublicCode) - unique, random, never the internal Id.</summary>
    public string PublicCode { get; private set; } = null!;

    /// <summary>
    /// Optional name shown to collaborators (see UserDisplayName) - null until the user sets one,
    /// in which case clients show the Juple ID instead. Not unique; never used for lookup.
    /// </summary>
    public string? DisplayName { get; private set; }

    public string PreferredLocale { get; private set; } = null!;

    public string TimeZoneId { get; private set; } = null!;

    public string? DefaultCurrencyCode { get; private set; }

    public UserPlan Plan { get; private set; }

    /// <summary>
    /// The account's free-trial window (see Juple.Domain.Billing.TrialPolicy) - null until the subscription program is
    /// enabled and the account has been evaluated (never backfilled from "now"). Explicit account state: not derived
    /// from CreatedAtUtc and not from <see cref="Plan"/>, which stays legacy compatibility only.
    /// </summary>
    public DateTimeOffset? TrialStartedAtUtc { get; private set; }

    public DateTimeOffset? TrialEndsAtUtc { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>No-op when already on this Plan - mirrors Item.SetPreviewImageUrl/SetCoverImageId's own no-op-on-unchanged-value pattern. Not called by anything yet (see UserPlan's own remarks); this is the one place a future billing/webhook integration will call.</summary>
    /// <summary>Replaces a freshly generated code that collided with an existing one before the first insert - never used to change an established Juple ID.</summary>
    public void RegeneratePublicCodeBeforeCreate()
    {
        PublicCode = UserPublicCode.Generate();
    }

    /// <summary>Records the trial window (only ever the ledger's original one - see EntitlementService).</summary>
    public void SetTrial(Juple.Domain.Billing.TrialWindow window)
    {
        TrialStartedAtUtc = window.StartedAtUtc;
        TrialEndsAtUtc = window.EndsAtUtc;
    }

    public void SetPlan(UserPlan plan, DateTimeOffset updatedAtUtc)
    {
        if (Plan == plan)
        {
            return;
        }

        Plan = plan;
        UpdatedAtUtc = updatedAtUtc;
    }

    /// <summary>Callers pass a value already normalized by UserDisplayName.TryNormalize (null clears it).</summary>
    public void SetDisplayName(string? displayName, DateTimeOffset updatedAtUtc)
    {
        if (DisplayName == displayName)
        {
            return;
        }

        DisplayName = displayName;
        UpdatedAtUtc = updatedAtUtc;
    }

    /// <summary>
    /// The user's own profile photo (see UserProfileImage in Juple.Application), stored under the
    /// user's own Blob prefix ("items/{Id}/profile/...") so account deletion's prefix cleanup
    /// removes it. Null (the common case, and every user created before this existed): no photo -
    /// clients show a fallback avatar.
    /// </summary>
    public string? ProfileImageBlobName { get; private set; }

    /// <summary>Sets (or, with null, clears) the profile photo; returns the Blob it replaced, if any, for the caller to delete.</summary>
    public string? SetProfileImage(string? blobName, DateTimeOffset updatedAtUtc)
    {
        var previous = ProfileImageBlobName;
        if (previous == blobName)
        {
            return null;
        }

        ProfileImageBlobName = blobName;
        UpdatedAtUtc = updatedAtUtc;
        return previous;
    }

    public void UpdateTimeZone(string timeZoneId, DateTimeOffset updatedAtUtc)
    {
        TimeZoneId = timeZoneId;
        UpdatedAtUtc = updatedAtUtc;
    }
}
