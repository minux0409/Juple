using Juple.Domain.Billing;

namespace Juple.Application.Billing;

/// <summary>
/// Bound from the "Billing" configuration section - the explicit, server-side switch for the subscription program.
///
/// ProgramEnabled defaults to false: nobody is restricted, no trial is started or consumed, nothing is frozen, and the
/// app behaves exactly as it did before billing existed. It is turned on later, deliberately, with a real ProgramStartAtUtc
/// (see <see cref="TrialPolicy"/> for how that instant sets the existing accounts' fresh 30 days).
///
/// TrialDurationDays exists only so a configuration that disagrees with the fixed 30-day product decision fails loudly
/// at startup instead of silently becoming a different policy; the trial length itself is TrialPolicy, not this value.
///
/// TrialIdentityHashKey is the HMAC secret (Base64, at least 32 bytes) for the trial ledger. It is required only while the
/// program is enabled, is never committed, and comes from user-secrets locally and from the environment / a Key Vault-backed
/// Container Apps secret reference when deployed (Billing__TrialIdentityHashKey) - no code change is needed to move it.
/// There is no development entitlement override of any kind.
/// </summary>
public sealed class BillingOptions
{
    public const int MinimumHashKeyBytes = 32;

    public bool ProgramEnabled { get; set; }

    public DateTimeOffset? ProgramStartAtUtc { get; set; }

    public int TrialDurationDays { get; set; } = TrialPolicy.DurationDays;

    public string? TrialIdentityHashKey { get; set; }

    /// <summary>Google Play billing (R39-B1). Disabled by default: the API starts with none of its secrets.</summary>
    public GoogleBillingOptions Google { get; set; } = new();

    /// <summary>The durable billing-event wake-up queue (shared by the API, the worker and the reconcile job).</summary>
    public BillingEventsOptions Events { get; set; } = new();
}

/// <summary>
/// Google Play billing settings. Nothing here is a default product: ProductId / BasePlanId stay null until the Play Console
/// subscription is created and approved (R39-B2), and every secret comes only from user-secrets locally or from
/// environment / Key Vault-backed Container Apps secret references when deployed - never from a committed file.
/// </summary>
public sealed class GoogleBillingOptions
{
    public const string DefaultPackageName = "com.juple.app";

    public bool Enabled { get; set; }

    public string PackageName { get; set; } = DefaultPackageName;

    /// <summary>The ONE allowlisted subscription product. Null until it exists in Play Console.</summary>
    public string? ProductId { get; set; }

    /// <summary>The allowlisted base plan of that product. Null until it exists.</summary>
    public string? BasePlanId { get; set; }

    /// <summary>The Google service-account credential JSON (a secret). See IGoogleCredentialSource for the swappable source.</summary>
    public string? ServiceAccountCredentialJson { get; set; }

    /// <summary>Base64, at least 32 bytes: keys the opaque account id given to Google. Its own secret.</summary>
    public string? AccountHashKey { get; set; }

    /// <summary>Base64, exactly 32 bytes: AES-256-GCM key sealing purchase tokens at rest. Its own secret.</summary>
    public string? PurchaseTokenEncryptionKey { get; set; }

    public GooglePubSubOptions PubSub { get; set; } = new();
}

/// <summary>What authenticates Google's Pub/Sub push to the public RTDN endpoint (an OIDC token, not a Juple login).</summary>
public sealed class GooglePubSubOptions
{
    /// <summary>The OIDC audience the push subscription is configured with (the webhook URL).</summary>
    public string? Audience { get; set; }

    /// <summary>The service account the push subscription signs its OIDC token as.</summary>
    public string? PushServiceAccountEmail { get; set; }
}

public sealed class BillingEventsOptions
{
    public const string DefaultQueueName = "billing-events";

    /// <summary>Fully-qualified Service Bus namespace. Empty = no wake-up signal; the sweep still processes every event.</summary>
    public string? ServiceBusNamespace { get; set; }

    public string QueueName { get; set; } = DefaultQueueName;
}

public static class BillingOptionsValidator
{
    /// <summary>Throws <see cref="InvalidOperationException"/> with the exact setting at fault. Never echoes the secret.</summary>
    public static void Validate(BillingOptions options)
    {
        if (options.TrialDurationDays != TrialPolicy.DurationDays)
        {
            throw new InvalidOperationException(
                $"Billing:TrialDurationDays must be {TrialPolicy.DurationDays} (the trial length is a fixed product decision), but is {options.TrialDurationDays}.");
        }

        if (!options.ProgramEnabled)
        {
            // Nothing else is required (or looked at) until the program is launched.
            return;
        }

        if (options.ProgramStartAtUtc is null)
        {
            throw new InvalidOperationException("Billing:ProgramStartAtUtc is required when Billing:ProgramEnabled is true.");
        }

        if (!TrialIdentityHasher.TryDecodeKey(options.TrialIdentityHashKey, out _))
        {
            throw new InvalidOperationException(
                $"Billing:TrialIdentityHashKey is required when Billing:ProgramEnabled is true: a Base64 value of at least {BillingOptions.MinimumHashKeyBytes} bytes.");
        }
    }

    /// <summary>
    /// Google billing is validated independently of the trial program: it can be enabled for sandbox purchases while
    /// ProgramEnabled stays false. Disabled = nothing required. Enabled = everything required, and the three secrets must be
    /// distinct. The message names the setting and never echoes a value.
    /// </summary>
    public static void ValidateGoogle(BillingOptions options)
    {
        var google = options.Google;
        if (!google.Enabled)
        {
            return;
        }

        static void Require(string? value, string setting)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException($"{setting} is required when Billing:Google:Enabled is true.");
            }
        }

        Require(google.PackageName, "Billing:Google:PackageName");
        Require(google.ProductId, "Billing:Google:ProductId");
        Require(google.BasePlanId, "Billing:Google:BasePlanId");
        Require(google.ServiceAccountCredentialJson, "Billing:Google:ServiceAccountCredentialJson");
        Require(google.PubSub.Audience, "Billing:Google:PubSub:Audience");
        Require(google.PubSub.PushServiceAccountEmail, "Billing:Google:PubSub:PushServiceAccountEmail");

        if (!TrialIdentityHasher.TryDecodeKey(google.AccountHashKey, out _))
        {
            throw new InvalidOperationException(
                $"Billing:Google:AccountHashKey is required when Billing:Google:Enabled is true: a Base64 value of at least {BillingOptions.MinimumHashKeyBytes} bytes.");
        }

        if (!PurchaseTokenProtector.TryDecodeKey(google.PurchaseTokenEncryptionKey, out _))
        {
            throw new InvalidOperationException(
                "Billing:Google:PurchaseTokenEncryptionKey is required when Billing:Google:Enabled is true: a Base64 value of exactly 32 bytes.");
        }

        var secrets = new[] { google.AccountHashKey, google.PurchaseTokenEncryptionKey, options.TrialIdentityHashKey }
            .Where(secret => !string.IsNullOrWhiteSpace(secret))
            .ToList();
        if (secrets.Count != secrets.Distinct(StringComparer.Ordinal).Count())
        {
            throw new InvalidOperationException(
                "The billing secrets (Billing:Google:AccountHashKey, Billing:Google:PurchaseTokenEncryptionKey, Billing:TrialIdentityHashKey) must each be a distinct value.");
        }
    }
}
