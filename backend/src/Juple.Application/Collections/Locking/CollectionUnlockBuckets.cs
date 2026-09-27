using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Juple.Domain.Collections;

namespace Juple.Application.Collections.Locking;

/// <summary>One failed-attempt counter an unlock attempt is charged to, and its own limit.</summary>
/// <param name="ResetOnSuccess">Whether a correct password clears it (never for a shared ceiling).</param>
public sealed record CollectionUnlockBucket(string Key, int MaxFailures, bool ResetOnSuccess);

/// <summary>
/// Which counters an unlock attempt is charged to.
///
/// Signed-in (in-app) unlock: the user's own bucket, 5 failures per 15 minutes - identity is certain.
///
/// Anonymous public share unlock - two tiers, so one person's wrong guesses cannot lock everyone else
/// out of a link (the earlier single link-wide 5-per-15-minutes limit could be tripped on purpose):
/// 1. per client: 5 failures / 15 min per opaque browser attempt id (a random HttpOnly cookie the
///    Public Web issues; it carries no identity or permission). Clearing the cookie starts a new
///    bucket - this tier limits accidental and casual guessing, not a determined attacker.
/// 2. per link: a high safety ceiling, PublicShareCeiling failures / 15 min across all clients, so an
///    automated attack is still bounded (and the PBKDF2 cost it can impose too) without a few
///    requests being enough to block legitimate visitors.
/// A request without a well-formed attempt id shares one "anonymous" client bucket per link.
/// No client IP is used: behind the Public Web server it is not reliably available, and a
/// forwarded-for header is never trusted. An edge/WAF rate limit can be layered in front later.
/// </summary>
public static partial class CollectionUnlockBuckets
{
    public const int PublicShareCeiling = 100;

    public static IReadOnlyList<CollectionUnlockBucket> ForUser(long userId) =>
        [new(CollectionUnlockSubject.ForUser(userId).ThrottleKey, CollectionUnlockThrottle.MaxFailures, ResetOnSuccess: true)];

    public static IReadOnlyList<CollectionUnlockBucket> ForPublicShare(long shareId, string? clientAttemptId) =>
    [
        new($"pc:{shareId}:{ClientKey(clientAttemptId)}", CollectionUnlockThrottle.MaxFailures, ResetOnSuccess: true),
        new(CollectionUnlockSubject.ForPublicShare(shareId).ThrottleKey, PublicShareCeiling, ResetOnSuccess: false),
    ];

    /// <summary>The attempt id is never stored as-is - only a truncated SHA-256 of it (32 hex chars).</summary>
    private static string ClientKey(string? clientAttemptId)
    {
        if (string.IsNullOrEmpty(clientAttemptId) || !AttemptIdPattern().IsMatch(clientAttemptId))
        {
            return "anon";
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(clientAttemptId)))[..32].ToLowerInvariant();
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{22,64}$")]
    private static partial Regex AttemptIdPattern();
}
