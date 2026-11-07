using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Juple.Application.Billing.Apple;

/// <summary>
/// <c>HMAC-SHA256(Billing:Apple:AccountTokenKey, "juple-apple-account-v1|" + userId)</c>, first 16 bytes shaped as a version-4 UUID: the App
/// Account Token given to StoreKit for one account. Deterministic per account, not the internal UserId, not reversible without the key.
/// </summary>
public interface IAppleAccountTokenProvider
{
    Guid Compute(long userId);
}

public sealed class AppleAccountTokenProvider(BillingOptions options) : IAppleAccountTokenProvider
{
    public const string DomainPrefix = "juple-apple-account-v1";

    public Guid Compute(long userId)
    {
        if (!TrialIdentityHasher.TryDecodeKey(options.Apple.AccountTokenKey, out var key))
        {
            throw new InvalidOperationException("Billing:Apple:AccountTokenKey is not configured.");
        }

        var bytes = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"{DomainPrefix}|{userId}")).AsSpan(0, 16).ToArray();
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }
}

/// <summary>Seals the stored original-transaction handle under the dedicated Apple key (never the Google or trial keys).</summary>
public interface IApplePurchaseHandleProtector : IPurchaseTokenProtector;

public sealed class ApplePurchaseHandleProtector : PurchaseTokenProtector, IApplePurchaseHandleProtector
{
    private readonly BillingOptions options;

    public ApplePurchaseHandleProtector(BillingOptions options)
        : base(options)
    {
        this.options = options;
    }

    protected override string? ConfiguredKey => options.Apple.HandleEncryptionKey;

    protected override string ConfiguredKeyName => "Billing:Apple:HandleEncryptionKey";
}

/// <summary>
/// Reads the three signed payload kinds of the App Store (after <see cref="IAppleJwsVerifier"/> verified them) into the small records Juple
/// uses. Anything missing that a decision depends on is "malformed": never guessed.
/// </summary>
public static class ApplePayloads
{
    /// <summary>The stored handle: the original transaction id with its environment, because the API host depends on it.</summary>
    public static string ToHandle(AppleEnvironment environment, string originalTransactionId) => $"{environment}|{originalTransactionId}";

    public static (AppleEnvironment Environment, string OriginalTransactionId) FromHandle(string handle)
    {
        var separator = handle.IndexOf('|', StringComparison.Ordinal);
        if (separator <= 0 || !Enum.TryParse<AppleEnvironment>(handle[..separator], ignoreCase: false, out var environment) || separator == handle.Length - 1)
        {
            throw new AppleMalformedException("A stored handle is not an original transaction handle.");
        }

        return (environment, handle[(separator + 1)..]);
    }

    public static AppleTransaction ParseTransaction(string json)
    {
        using var document = ParseObject(json);
        var root = document.RootElement;
        return new AppleTransaction(
            RequireString(root, "transactionId"),
            RequireString(root, "originalTransactionId"),
            RequireString(root, "bundleId"),
            RequireString(root, "productId"),
            Millis(root, "purchaseDate"),
            Millis(root, "originalPurchaseDate"),
            Millis(root, "expiresDate"),
            Millis(root, "revocationDate"),
            Token(root),
            ParseEnvironment(OptionalString(root, "environment")),
            OptionalString(root, "type"));
    }

    public static AppleRenewalInfo ParseRenewal(string json)
    {
        using var document = ParseObject(json);
        var root = document.RootElement;
        return new AppleRenewalInfo(
            RequireString(root, "originalTransactionId"),
            OptionalString(root, "autoRenewProductId"),
            root.TryGetProperty("autoRenewStatus", out var auto) && auto.ValueKind == JsonValueKind.Number ? auto.GetInt32() == 1 : null,
            root.TryGetProperty("expirationIntent", out var intent) && intent.ValueKind == JsonValueKind.Number ? intent.GetInt32() : null,
            root.TryGetProperty("isInBillingRetryPeriod", out var retry) && retry.ValueKind is JsonValueKind.True or JsonValueKind.False ? retry.GetBoolean() : null,
            Millis(root, "gracePeriodExpiresDate"));
    }

    /// <summary>The verified notification body; the nested signed transaction (when present) is verified and decoded by <paramref name="verifier"/>.</summary>
    public static AppleNotification ParseNotification(string json, IAppleJwsVerifier verifier)
    {
        using var document = ParseObject(json);
        var root = document.RootElement;
        var type = RequireString(root, "notificationType");
        var uuid = RequireString(root, "notificationUUID");
        var subtype = OptionalString(root, "subtype");
        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
        {
            // TEST notifications (and a few others) have a "data" object too, but a "summary" for extensions - no purchase either way.
            return new AppleNotification(uuid, type, subtype, ParseEnvironment(null), string.Empty, null);
        }

        var environment = ParseEnvironment(OptionalString(data, "environment"));
        var bundleId = OptionalString(data, "bundleId") ?? string.Empty;
        AppleTransaction? transaction = null;
        if (OptionalString(data, "signedTransactionInfo") is { } signed)
        {
            transaction = ParseTransaction(verifier.VerifyAndGetPayload(signed));
        }

        return new AppleNotification(uuid, type, subtype, environment, bundleId, transaction);
    }

    private static JsonDocument ParseObject(string json)
    {
        try
        {
            var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                throw new AppleMalformedException("A payload is not an object.");
            }

            return document;
        }
        catch (JsonException)
        {
            throw new AppleMalformedException("A payload is not JSON.");
        }
    }

    private static string RequireString(JsonElement element, string name) =>
        OptionalString(element, name) is { Length: > 0 } value ? value : throw new AppleMalformedException($"A payload lacks {name}.");

    private static string? OptionalString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static DateTimeOffset? Millis(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var millis)
            ? DateTimeOffset.FromUnixTimeMilliseconds(millis)
            : null;

    private static Guid? Token(JsonElement element) =>
        OptionalString(element, "appAccountToken") is { } text && Guid.TryParse(text, CultureInfo.InvariantCulture, out var token) ? token : null;

    private static AppleEnvironment ParseEnvironment(string? value) =>
        string.Equals(value, "Production", StringComparison.OrdinalIgnoreCase) ? AppleEnvironment.Production : AppleEnvironment.Sandbox;
}
