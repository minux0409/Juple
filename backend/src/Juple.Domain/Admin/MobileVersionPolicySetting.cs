namespace Juple.Domain.Admin;

/// <summary>
/// The app-update build numbers of ONE platform as an operator set them in the Admin Web. A platform without a row keeps using the
/// deployed MobileVersionPolicy configuration, so the row only ever overrides it - an API revision that predates this table, or a
/// database without a row, behaves exactly as before. The store URL is not part of it (it stays configuration).
/// Build numbers are the platform's own (Android versionCode / iOS CFBundleVersion). Version is the optimistic concurrency token:
/// two operators editing at the same time cannot silently overwrite each other.
/// </summary>
public sealed class MobileVersionPolicySetting
{
    public const int MaxPlatformLength = 16;

    /// <summary>The stored platform keys (a stable contract - also checked by a database constraint).</summary>
    public const string Android = "android";

    public const string Ios = "ios";

    private MobileVersionPolicySetting()
    {
    }

    public MobileVersionPolicySetting(string platform, int latestBuild, int minimumSupportedBuild, long? updatedByAdminUserId, DateTimeOffset updatedAtUtc)
    {
        Platform = platform;
        Change(latestBuild, minimumSupportedBuild, updatedByAdminUserId, updatedAtUtc);
    }

    /// <summary>"android" or "ios" - the primary key.</summary>
    public string Platform { get; private set; } = null!;

    /// <summary>The newest build available in the store.</summary>
    public int LatestBuild { get; private set; }

    /// <summary>The oldest build still allowed to run; an installed build below it must update.</summary>
    public int MinimumSupportedBuild { get; private set; }

    /// <summary>The internal UserId of the admin who saved it last; null when an operator procedure wrote it.</summary>
    public long? UpdatedByAdminUserId { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] Version { get; private set; } = [];

    public void Change(int latestBuild, int minimumSupportedBuild, long? updatedByAdminUserId, DateTimeOffset updatedAtUtc)
    {
        LatestBuild = latestBuild;
        MinimumSupportedBuild = minimumSupportedBuild;
        UpdatedByAdminUserId = updatedByAdminUserId;
        UpdatedAtUtc = updatedAtUtc;
    }
}
