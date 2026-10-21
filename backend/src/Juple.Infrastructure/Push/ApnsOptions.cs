using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Juple.Infrastructure.Push;

/// <summary>
/// Bound from the "Apns" configuration section - direct Apple Push Notification service delivery for iOS with token-based (JWT)
/// authentication. Nothing is configured by default: with no key, iOS registrations are kept but their deliveries fail with
/// push_transport_not_configured (transient, retried until the notification expires) and Android is unaffected.
///
/// <see cref="PrivateKeyPem"/> is the content of the AuthKey_XXXXXXXXXX.p8 file from Apple Developer (Keys) - a secret: user-secrets
/// locally, a Key Vault-backed Container Apps secret (Apns__PrivateKeyPem) when deployed, never a committed file, never logged.
/// Half a configuration is refused at startup (<see cref="Validate"/>) instead of silently never delivering.
/// </summary>
public sealed partial class ApnsOptions
{
    public const string SectionName = "Apns";

    public const string DefaultBundleId = "com.juple.app";

    /// <summary>The 10-character Key ID of the APNs auth key.</summary>
    public string? KeyId { get; set; }

    /// <summary>The 10-character Apple Developer Team ID (the JWT issuer).</summary>
    public string? TeamId { get; set; }

    /// <summary>The PKCS#8 PEM of the .p8 auth key ("-----BEGIN PRIVATE KEY-----...").</summary>
    public string? PrivateKeyPem { get; set; }

    /// <summary>The apns-topic: the iOS app's bundle identifier.</summary>
    public string BundleId { get; set; } = DefaultBundleId;

    public string ProductionEndpoint { get; set; } = "https://api.push.apple.com";

    public string DevelopmentEndpoint { get; set; } = "https://api.sandbox.push.apple.com";

    /// <summary>
    /// One send's own time budget - well under NotificationDeliveryStore's stale-claim lease, so a hung call frees its claim long before
    /// anyone could reclaim it (the same reasoning as FirebaseCloudMessagingSender's timeout).
    /// </summary>
    public int SendTimeoutSeconds { get; set; } = 10;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(KeyId) || !string.IsNullOrWhiteSpace(TeamId) || !string.IsNullOrWhiteSpace(PrivateKeyPem);

    /// <summary>Null when the options are usable (or entirely absent); otherwise the first problem, naming the setting - never a key value.</summary>
    public string? Validate()
    {
        if (!IsConfigured)
        {
            return null;
        }

        if (KeyId is null || !AppleIdPattern().IsMatch(KeyId))
        {
            return "Apns:KeyId must be the 10-character APNs key ID when Apns is configured.";
        }

        if (TeamId is null || !AppleIdPattern().IsMatch(TeamId))
        {
            return "Apns:TeamId must be the 10-character Apple Developer Team ID when Apns is configured.";
        }

        if (string.IsNullOrWhiteSpace(BundleId) || BundleId.Any(char.IsWhiteSpace))
        {
            return "Apns:BundleId must be the iOS app's bundle identifier.";
        }

        foreach (var (name, value) in new[] { ("ProductionEndpoint", ProductionEndpoint), ("DevelopmentEndpoint", DevelopmentEndpoint) })
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            {
                return $"Apns:{name} must be an absolute https URL.";
            }
        }

        if (SendTimeoutSeconds is < 1 or > 60)
        {
            return "Apns:SendTimeoutSeconds must be between 1 and 60.";
        }

        try
        {
            using var key = ImportKey(PrivateKeyPem);
            if (key.KeySize != 256)
            {
                return "Apns:PrivateKeyPem must be the P-256 (ES256) APNs auth key.";
            }
        }
        catch (Exception exception) when (exception is CryptographicException or ArgumentException or FormatException)
        {
            return "Apns:PrivateKeyPem must be the PEM content of the .p8 APNs auth key.";
        }

        return null;
    }

    /// <summary>Imports the .p8 key; accepts the PEM text, or (as some secret stores keep it) the bare Base64 body.</summary>
    internal static ECDsa ImportKey(string? privateKeyPem)
    {
        if (string.IsNullOrWhiteSpace(privateKeyPem))
        {
            throw new ArgumentException("No APNs private key.", nameof(privateKeyPem));
        }

        var key = ECDsa.Create();
        try
        {
            var text = privateKeyPem.Trim().Replace("\\n", "\n", StringComparison.Ordinal);
            if (text.Contains("-----BEGIN", StringComparison.Ordinal))
            {
                key.ImportFromPem(text);
            }
            else
            {
                key.ImportPkcs8PrivateKey(Convert.FromBase64String(text), out _);
            }

            return key;
        }
        catch
        {
            key.Dispose();
            throw;
        }
    }

    [GeneratedRegex("^[A-Z0-9]{10}$")]
    private static partial Regex AppleIdPattern();
}
