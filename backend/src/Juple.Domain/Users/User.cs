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
    }

    public long Id { get; private set; }

    public string PreferredLocale { get; private set; } = null!;

    public string TimeZoneId { get; private set; } = null!;

    public string? DefaultCurrencyCode { get; private set; }

    public UserPlan Plan { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>No-op when already on this Plan - mirrors Item.SetPreviewImageUrl/SetCoverImageId's own no-op-on-unchanged-value pattern. Not called by anything yet (see UserPlan's own remarks); this is the one place a future billing/webhook integration will call.</summary>
    public void SetPlan(UserPlan plan, DateTimeOffset updatedAtUtc)
    {
        if (Plan == plan)
        {
            return;
        }

        Plan = plan;
        UpdatedAtUtc = updatedAtUtc;
    }
}
