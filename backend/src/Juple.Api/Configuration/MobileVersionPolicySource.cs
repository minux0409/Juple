using Juple.Application.Admin;
using Juple.Domain.Admin;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Juple.Api.Configuration;

/// <summary>
/// The MobileVersionPolicy the API serves (the sign-in-free app-update check and the bootstrap response): the deployed
/// configuration, with the build numbers of any platform an operator saved in the Admin Web (admin.MobileVersionPolicies) taking
/// its place. The store URL always comes from configuration. A platform without a row is exactly the configuration, so nothing
/// changes until someone saves.
///
/// The result is cached per API replica for <see cref="CacheDuration"/> (the anonymous check is called on every app start and
/// foreground), so a save reaches every replica within that time; the replica that saved drops its copy at once. When the database
/// cannot be read, the configuration is served (and logged) - the same values the API served before the table existed - rather
/// than failing the update check or the sign-in.
/// </summary>
public sealed class MobileVersionPolicySource(
    IOptions<MobileVersionPolicyOptions> configured,
    IMobileVersionPolicyStore store,
    IMemoryCache cache,
    ILogger<MobileVersionPolicySource> logger)
{
    public static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan FailureCacheDuration = TimeSpan.FromSeconds(10);
    private const string CacheKey = "mobile-version-policy:effective";

    public async Task<MobileVersionPolicyOptions> GetAsync(CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue<MobileVersionPolicyOptions>(CacheKey, out var cached) && cached is not null)
        {
            return cached;
        }

        MobileVersionPolicyOptions effective;
        TimeSpan duration;
        try
        {
            effective = Merge(configured.Value, await store.ListAsync(cancellationToken));
            duration = CacheDuration;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "MobileVersionPolicy overrides could not be read; serving the configured policy.");
            effective = Merge(configured.Value, []);
            duration = FailureCacheDuration;
        }

        // The shared cache has a SizeLimit, so every entry must carry a size.
        cache.Set(CacheKey, effective, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = duration, Size = 1 });
        return effective;
    }

    /// <summary>After a save on this replica: the next read goes to the database.</summary>
    public void Invalidate() => cache.Remove(CacheKey);

    /// <summary>A copy of the configuration with each saved platform's build numbers. The configured options are never mutated.</summary>
    public static MobileVersionPolicyOptions Merge(MobileVersionPolicyOptions options, IReadOnlyList<StoredMobileVersionPolicy> rows) => new()
    {
        Android = MergePlatform("Android", options.Android, rows.FirstOrDefault(row => row.Platform == MobileVersionPolicySetting.Android)),
        Ios = MergePlatform("Ios", options.Ios, rows.FirstOrDefault(row => row.Platform == MobileVersionPolicySetting.Ios)),
    };

    private static MobilePlatformVersionPolicy MergePlatform(string name, MobilePlatformVersionPolicy configuredPolicy, StoredMobileVersionPolicy? row)
    {
        var merged = new MobilePlatformVersionPolicy
        {
            LatestBuild = row?.LatestBuild ?? configuredPolicy.LatestBuild,
            MinimumSupportedBuild = row?.MinimumSupportedBuild ?? configuredPolicy.MinimumSupportedBuild,
            StoreUrl = configuredPolicy.StoreUrl,
        };

        // The same last line of defence as for configuration (Program.cs): a contradictory policy is no policy, never a block.
        return merged.Validate(name) is null ? merged : new MobilePlatformVersionPolicy();
    }
}
