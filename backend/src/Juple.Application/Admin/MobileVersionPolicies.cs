using Juple.Domain.Admin;

namespace Juple.Application.Admin;

/// <summary>The two build numbers of one platform (Android versionCode / iOS CFBundleVersion). 0 / 0 = no policy.</summary>
public sealed record MobileBuildPolicy(int LatestBuild, int MinimumSupportedBuild);

/// <summary>A platform's saved row; Version is the opaque concurrency token the next save must send back.</summary>
public sealed record StoredMobileVersionPolicy(
    string Platform,
    int LatestBuild,
    int MinimumSupportedBuild,
    long? UpdatedByAdminUserId,
    DateTimeOffset UpdatedAtUtc,
    string Version);

/// <summary>
/// What an operator asks for. ExpectedVersion is the Version they saw (null while the platform still runs on configuration).
/// The two confirmations are the server-side half of the Admin Web's confirm dialog: raising the minimum forces older installed
/// builds to update, and lowering the latest withdraws an update prompt - neither happens without saying so explicitly.
/// </summary>
public sealed record MobileVersionPolicyChange(
    int LatestBuild,
    int MinimumSupportedBuild,
    string? ExpectedVersion,
    bool ConfirmMinimumIncrease = false,
    bool ConfirmLatestDecrease = false);

/// <summary>Changed is false when the request equals the current values: nothing was written and nothing audited.</summary>
public sealed record MobileVersionPolicySaveResult(bool Changed, StoredMobileVersionPolicy? Stored);

/// <summary>The platform's row changed (or appeared) since the operator loaded it.</summary>
public sealed class MobileVersionPolicyConflictException : Exception;

public interface IMobileVersionPolicyStore
{
    Task<IReadOnlyList<StoredMobileVersionPolicy>> ListAsync(CancellationToken cancellationToken = default);

    Task<StoredMobileVersionPolicy?> GetAsync(string platform, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts (expectedVersion null) or updates (expectedVersion = the row's Version) the platform's row and writes the audit record
    /// in the same transaction. Throws MobileVersionPolicyConflictException when the row is not in the expected state any more.
    /// </summary>
    Task<StoredMobileVersionPolicy> SaveAsync(
        long adminUserId,
        string platform,
        string? expectedVersion,
        MobileBuildPolicy builds,
        string auditDetail,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The Admin Web's app-version editing. The current values a change is judged against are the platform's row, or - without one -
/// the deployed configuration (passed in by the caller, which owns that configuration). Every rule is enforced here, whatever the
/// browser checked.
/// </summary>
public sealed class MobileVersionPolicyAdminService(IMobileVersionPolicyStore store, TimeProvider timeProvider)
{
    /// <summary>Android versionCode's own ceiling; iOS build numbers are far below it.</summary>
    public const int MaxBuild = 2_100_000_000;

    public static string Platform(string? value) => value?.ToLowerInvariant() switch
    {
        MobileVersionPolicySetting.Android => MobileVersionPolicySetting.Android,
        MobileVersionPolicySetting.Ios => MobileVersionPolicySetting.Ios,
        _ => throw new InvalidAdminRequestException("platform", "Use android or ios."),
    };

    public Task<IReadOnlyList<StoredMobileVersionPolicy>> ListAsync(CancellationToken cancellationToken = default) =>
        store.ListAsync(cancellationToken);

    public async Task<MobileVersionPolicySaveResult> SaveAsync(
        long adminUserId,
        string platform,
        MobileVersionPolicyChange change,
        MobileBuildPolicy configured,
        CancellationToken cancellationToken = default)
    {
        var key = Platform(platform);
        var stored = await store.GetAsync(key, cancellationToken);
        if (!string.Equals(stored?.Version, NullIfEmpty(change.ExpectedVersion), StringComparison.Ordinal))
        {
            throw new MobileVersionPolicyConflictException();
        }

        var current = stored is null ? configured : new MobileBuildPolicy(stored.LatestBuild, stored.MinimumSupportedBuild);
        Validate(current, change);
        if (current.LatestBuild == change.LatestBuild && current.MinimumSupportedBuild == change.MinimumSupportedBuild)
        {
            return new MobileVersionPolicySaveResult(false, stored);
        }

        var detail = $"latest {current.LatestBuild}->{change.LatestBuild}; minimum {current.MinimumSupportedBuild}->{change.MinimumSupportedBuild}; "
            + $"from {(stored is null ? "configuration" : "database")}";
        var saved = await store.SaveAsync(
            adminUserId,
            key,
            stored?.Version,
            new MobileBuildPolicy(change.LatestBuild, change.MinimumSupportedBuild),
            detail,
            timeProvider.GetUtcNow(),
            cancellationToken);
        return new MobileVersionPolicySaveResult(true, saved);
    }

    /// <summary>The rules of a change against the platform's current values.</summary>
    public static void Validate(MobileBuildPolicy current, MobileVersionPolicyChange change)
    {
        if (change.LatestBuild is < 1 or > MaxBuild)
        {
            throw new InvalidAdminRequestException("latestBuild", $"Use a whole number from 1 to {MaxBuild}.");
        }

        if (change.MinimumSupportedBuild is < 1 or > MaxBuild)
        {
            throw new InvalidAdminRequestException("minimumSupportedBuild", $"Use a whole number from 1 to {MaxBuild}.");
        }

        if (change.MinimumSupportedBuild > change.LatestBuild)
        {
            throw new InvalidAdminRequestException("minimumSupportedBuild", "The minimum supported build cannot be above the latest build.");
        }

        if (change.LatestBuild < current.LatestBuild && !change.ConfirmLatestDecrease)
        {
            throw new InvalidAdminRequestException("confirmLatestDecrease", "Lowering the latest build must be confirmed.");
        }

        if (change.MinimumSupportedBuild > current.MinimumSupportedBuild && !change.ConfirmMinimumIncrease)
        {
            throw new InvalidAdminRequestException(
                "confirmMinimumIncrease",
                "Raising the minimum supported build forces older installed builds to update and must be confirmed.");
        }
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
