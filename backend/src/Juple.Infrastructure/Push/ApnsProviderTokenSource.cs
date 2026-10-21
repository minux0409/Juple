using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The APNs provider authentication token: an ES256-signed JWT (header alg/kid, claims iss = Team ID, iat) built from the .p8 key.
/// Apple accepts a token for up to an hour and rejects refreshing it more often than every 20 minutes (429
/// TooManyProviderTokenUpdates), so one token is reused for <see cref="RefreshAfter"/> and shared by every send of this process
/// (singleton, thread-safe). <see cref="Invalidate"/> drops a token APNs reported as expired/invalid, so the next send signs a new one.
/// The key never leaves this class and nothing here is ever logged.
/// </summary>
public sealed class ApnsProviderTokenSource : IDisposable
{
    public static readonly TimeSpan RefreshAfter = TimeSpan.FromMinutes(40);

    private readonly ECDsa key;
    private readonly string keyId;
    private readonly string teamId;
    private readonly TimeProvider timeProvider;
    private readonly Lock gate = new();
    private string? token;
    private DateTimeOffset issuedAtUtc;

    public ApnsProviderTokenSource(ApnsOptions options, TimeProvider timeProvider)
    {
        key = ApnsOptions.ImportKey(options.PrivateKeyPem);
        keyId = options.KeyId ?? throw new ArgumentException("Apns:KeyId is required.", nameof(options));
        teamId = options.TeamId ?? throw new ArgumentException("Apns:TeamId is required.", nameof(options));
        this.timeProvider = timeProvider;
    }

    public string GetToken()
    {
        var now = timeProvider.GetUtcNow();
        lock (gate)
        {
            // A clock that moved backwards also re-signs (never hand out a token "issued in the future").
            if (token is null || now - issuedAtUtc >= RefreshAfter || now < issuedAtUtc)
            {
                token = Sign(now);
                issuedAtUtc = now;
            }

            return token;
        }
    }

    /// <summary>
    /// After APNs refused this server's credentials (403: invalid/unrelated key, wrong team, a key not allowed on this gateway, ...)
    /// nothing a retry or a re-signed token can fix arrives sooner than a configuration change. For <see cref="AuthenticationCooldown"/>
    /// every send to that gateway fails at once as an auth error - no call to Apple, no new JWT (Apple throttles frequent token
    /// refreshes) - and is retried by the pipeline like any transient failure until the notification expires. The device token is never
    /// at fault and never disabled. Per gateway: a key restricted to one environment does not stop the other. Process-wide (singleton).
    /// </summary>
    public static readonly TimeSpan AuthenticationCooldown = TimeSpan.FromMinutes(10);

    private readonly Dictionary<Domain.Push.ApnsEnvironment, DateTimeOffset> blockedUntil = [];

    public bool IsAuthenticationBlocked(Domain.Push.ApnsEnvironment environment)
    {
        var now = timeProvider.GetUtcNow();
        lock (gate)
        {
            return blockedUntil.TryGetValue(environment, out var until) && now < until;
        }
    }

    public void BlockAuthentication(Domain.Push.ApnsEnvironment environment)
    {
        var until = timeProvider.GetUtcNow() + AuthenticationCooldown;
        lock (gate)
        {
            blockedUntil[environment] = until;
        }
    }

    /// <summary>Forgets <paramref name="rejected"/> if it is still the current token (a concurrent send may already have replaced it).</summary>
    public void Invalidate(string rejected)
    {
        lock (gate)
        {
            if (string.Equals(token, rejected, StringComparison.Ordinal))
            {
                token = null;
            }
        }
    }

    private string Sign(DateTimeOffset now)
    {
        var header = JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, string> { ["alg"] = "ES256", ["kid"] = keyId });
        var claims = JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object> { ["iss"] = teamId, ["iat"] = now.ToUnixTimeSeconds() });
        var signingInput = $"{Base64Url.EncodeToString(header)}.{Base64Url.EncodeToString(claims)}";
        // JWS ES256 wants the raw r||s form (IEEE P1363), which is .NET's default for ECDsa.SignData.
        var signature = key.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"{signingInput}.{Base64Url.EncodeToString(signature)}";
    }

    public void Dispose() => key.Dispose();
}
