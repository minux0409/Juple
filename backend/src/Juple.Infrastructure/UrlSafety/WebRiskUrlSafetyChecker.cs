using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Juple.Application.UrlSafety;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.UrlSafety;

/// <summary>
/// Checks a URL against Google Web Risk's uris.search lookup API - see
/// https://cloud.google.com/web-risk/docs/reference/rest/v1/uris/search. Chosen over Google Safe
/// Browsing because Safe Browsing's terms restrict it to noncommercial use; Web Risk is the same
/// Google threat-list data with explicit commercial-use pricing (first 100k lookups/month free,
/// then per-1000-call tiers) and a simpler API-key auth model (no OAuth/service-account
/// credential needed for this endpoint).
///
/// This never connects to the caller-supplied URL itself - only its string value is sent to
/// Google's fixed webrisk.googleapis.com endpoint (set as this HttpClient's BaseAddress in
/// DependencyInjection.AddUrlSafetyChecker) - so, unlike UrlMetadataResolver, there is no SSRF
/// surface here and no ConnectCallback/DNS-rebinding guard is needed.
///
/// Always best-effort: a missing API key, timeout, non-success status, or malformed response all
/// resolve to UrlSafetyResult.Unavailable rather than throwing - see IUrlSafetyChecker's contract.
/// Never treat "no threat found" as a safety guarantee - see UrlSafetyStatus.NoKnownThreat.
/// </summary>
public sealed class WebRiskUrlSafetyChecker(
    HttpClient httpClient,
    WebRiskOptions options,
    IMemoryCache memoryCache,
    TimeProvider timeProvider,
    ILogger<WebRiskUrlSafetyChecker> logger) : IUrlSafetyChecker
{
    private static readonly TimeSpan NoThreatCacheDuration = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MinThreatCacheDuration = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan MaxThreatCacheDuration = TimeSpan.FromHours(1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static readonly MemoryCacheEntryOptions NoThreatCacheEntryOptions = new()
    {
        AbsoluteExpirationRelativeToNow = NoThreatCacheDuration,
        Size = 1,
    };

    public async Task<UrlSafetyResult> CheckAsync(string url, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey))
        {
            // Provider not configured in this environment - an expected, non-error state (see
            // WebRiskOptions' own remarks). No HTTP call, no log spam per request.
            return UrlSafetyResult.Unavailable;
        }

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return UrlSafetyResult.Unavailable;
        }

        var cacheKey = $"UrlSafety:{uri}";
        if (memoryCache.TryGetValue(cacheKey, out UrlSafetyResult? cached) && cached is not null)
        {
            return cached;
        }

        var hostname = uri.Host;
        var startTimestamp = timeProvider.GetTimestamp();
        UrlSafetyResult result;
        string? failureCategory = null;

        try
        {
            var requestUri =
                $"v1/uris:search?key={Uri.EscapeDataString(options.ApiKey)}&uri={Uri.EscapeDataString(url)}" +
                "&threatTypes=MALWARE&threatTypes=SOCIAL_ENGINEERING&threatTypes=UNWANTED_SOFTWARE";

            using var response = await httpClient.GetAsync(requestUri, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                failureCategory = $"http_status_{(int)response.StatusCode}";
                result = UrlSafetyResult.Unavailable;
            }
            else
            {
                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                var parsed = await JsonSerializer.DeserializeAsync<UrisSearchResponse>(
                    stream, JsonOptions, cancellationToken);
                result = ToResult(parsed, cacheKey);
            }
        }
        catch (JsonException)
        {
            failureCategory = "malformed_response";
            result = UrlSafetyResult.Unavailable;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            failureCategory = "timeout";
            result = UrlSafetyResult.Unavailable;
        }
        catch (HttpRequestException)
        {
            failureCategory = "network_error";
            result = UrlSafetyResult.Unavailable;
        }

        var elapsedMs = timeProvider.GetElapsedTime(startTimestamp).TotalMilliseconds;
        LogOutcome(hostname, result, failureCategory, elapsedMs);

        // A genuinely unavailable check is never cached - a transient provider outage should not
        // pin every lookup for this URL to CheckUnavailable for up to NoThreatCacheDuration; ToResult
        // already cached the two real outcomes (threat/no-threat) itself, see below.
        return result;
    }

    /// <summary>
    /// Caches the two real outcomes here (not in the caller) so a threat result's TTL can use the
    /// response's own expireTime - clamped to [MinThreatCacheDuration, MaxThreatCacheDuration] so a
    /// provider-supplied value can neither pin a false positive for an unreasonably long time nor
    /// cause a near-zero-TTL cache stampede. A no-threat result has no such guidance from the
    /// provider (uris.search returns no expireTime for "no match"), so it uses a fixed short TTL
    /// matching UrlMetadataResolver's own cache duration for consistency.
    /// </summary>
    private UrlSafetyResult ToResult(UrisSearchResponse? response, string cacheKey)
    {
        var threat = response?.Threat;
        var threatTypes = threat?.ThreatTypes;
        if (threatTypes is not { Count: > 0 })
        {
            var noThreatResult = new UrlSafetyResult(UrlSafetyStatus.NoKnownThreat, []);
            memoryCache.Set(cacheKey, noThreatResult, NoThreatCacheEntryOptions);
            return noThreatResult;
        }

        var categories = threatTypes
            .Select(NormalizeThreatCategory)
            .Distinct()
            .ToArray();
        var threatResult = new UrlSafetyResult(UrlSafetyStatus.ThreatDetected, categories);

        var ttl = NoThreatCacheDuration;
        // Non-null here: threatTypes came from threat?.ThreatTypes and was just proven non-empty.
        if (DateTimeOffset.TryParse(threat!.ExpireTime, out var expireTime))
        {
            var providedTtl = expireTime - timeProvider.GetUtcNow();
            if (providedTtl > TimeSpan.Zero)
            {
                ttl = providedTtl < MinThreatCacheDuration
                    ? MinThreatCacheDuration
                    : providedTtl > MaxThreatCacheDuration
                        ? MaxThreatCacheDuration
                        : providedTtl;
            }
        }

        memoryCache.Set(cacheKey, threatResult, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ttl,
            Size = 1,
        });
        return threatResult;
    }

    private static UrlThreatCategory NormalizeThreatCategory(string providerThreatType) =>
        providerThreatType switch
        {
            "MALWARE" => UrlThreatCategory.Malware,
            "SOCIAL_ENGINEERING" or "SOCIAL_ENGINEERING_EXTENDED_COVERAGE" => UrlThreatCategory.SocialEngineering,
            "UNWANTED_SOFTWARE" => UrlThreatCategory.UnwantedSoftware,
            _ => UrlThreatCategory.Other,
        };

    /// <summary>
    /// Privacy-safe by construction: hostname only (never the full URL/query), never the provider
    /// API key, never the raw provider response body - only the normalized status/category and an
    /// HTTP-status-shaped failure category.
    /// </summary>
    private void LogOutcome(string hostname, UrlSafetyResult result, string? failureCategory, double elapsedMs)
    {
        if (failureCategory is not null)
        {
            logger.LogInformation(
                "URL safety check unavailable. Host={Hostname} Category={FailureCategory} ElapsedMs={ElapsedMs}",
                hostname, failureCategory, elapsedMs);
            return;
        }

        logger.LogInformation(
            "URL safety check completed. Host={Hostname} Status={Status} ThreatCount={ThreatCount} ElapsedMs={ElapsedMs}",
            hostname, result.Status, result.Threats.Count, elapsedMs);
    }

    private sealed class UrisSearchResponse
    {
        [JsonPropertyName("threat")]
        public ThreatMatch? Threat { get; set; }
    }

    private sealed class ThreatMatch
    {
        [JsonPropertyName("threatTypes")]
        public List<string>? ThreatTypes { get; set; }

        [JsonPropertyName("expireTime")]
        public string? ExpireTime { get; set; }
    }
}
