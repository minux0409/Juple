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

    /// <summary>Apple App Store billing (StoreKit + App Store Server API / Notifications V2). Disabled by default: the API starts with none of its secrets.</summary>
    public AppleBillingOptions Apple { get; set; } = new();

    /// <summary>The durable billing-event wake-up queue (shared by the API, the worker and the reconcile job).</summary>
    public BillingEventsOptions Events { get; set; } = new();

    /// <summary>The post-subscription data retention policy (Billing:DataRetention:*). Not in effect by default.</summary>
    public DataRetentionOptions DataRetention { get; set; } = new();
}

/// <summary>
/// Billing:DataRetention. <see cref="PolicyEffectiveAtUtc"/> is the instant the 6-month read-only retention policy took effect, as
/// published in the terms; until it is set (default: null) the policy is not in effect - no account is scheduled, no retention date is
/// shown, nothing is noticed. It never deletes anything by itself: deletion does not exist in this build (RET-06, blocked on legal
/// review and separate approval).
/// </summary>
public sealed class DataRetentionOptions
{
    public DateTimeOffset? PolicyEffectiveAtUtc { get; set; }
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

    /// <summary>
    /// All allowlisted base plans of the ONE membership subscription (monthly and yearly). <see cref="BasePlanId"/> (the original single
    /// setting) is included, so an existing deployment that only sets it keeps working unchanged.
    /// </summary>
    public List<string> BasePlanIds { get; set; } = [];

    /// <summary>The allowlist actually used: the legacy single plan plus the list, without blanks or duplicates, in a stable order.</summary>
    public IReadOnlyList<string> AllowedBasePlanIds =>
        new[] { BasePlanId }.Concat(BasePlanIds).Where(plan => !string.IsNullOrWhiteSpace(plan)).Select(plan => plan!.Trim()).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>The Google service-account credential JSON (a secret). See IGoogleCredentialSource for the swappable source.</summary>
    public string? ServiceAccountCredentialJson { get; set; }

    /// <summary>Base64, at least 32 bytes: keys the opaque account id given to Google. Its own secret.</summary>
    public string? AccountHashKey { get; set; }

    /// <summary>Base64, exactly 32 bytes: AES-256-GCM key sealing purchase tokens at rest. Its own secret.</summary>
    public string? PurchaseTokenEncryptionKey { get; set; }

    public GooglePubSubOptions PubSub { get; set; } = new();
}

/// <summary>
/// Apple App Store billing settings. Product ids are NOT defaults: they stay empty until the App Store Connect subscription group
/// exists. Every secret (the in-app purchase signing key, the two keys below) comes only from user-secrets locally or from
/// environment / Key Vault-backed Container Apps secret references when deployed - never from a committed file.
/// </summary>
public sealed class AppleBillingOptions
{
    public const string DefaultBundleId = "com.juple.app";

    public bool Enabled { get; set; }

    public string BundleId { get; set; } = DefaultBundleId;

    /// <summary>The allowlisted auto-renewable products (monthly and yearly of the ONE Juple membership group). Anything else is refused.</summary>
    public List<string> ProductIds { get; set; } = [];

    /// <summary>
    /// Whether a Sandbox transaction is accepted. App Review and TestFlight purchase in the Sandbox even against the production server, so
    /// the first release must accept it; the production verification of a Sandbox purchase only ever reaches the Sandbox API and grants
    /// the same access a real purchase would, which is why this is a deliberate, documented switch and not implicit.
    /// </summary>
    public bool AcceptSandbox { get; set; } = true;

    /// <summary>The App Store Connect issuer id (a UUID) of the in-app purchase API key.</summary>
    public string? IssuerId { get; set; }

    /// <summary>The key id of the in-app purchase API key (App Store Connect > Users and Access > Integrations > In-App Purchase).</summary>
    public string? KeyId { get; set; }

    /// <summary>The .p8 private key (PEM text, a secret). Used only to sign the short-lived App Store Server API token.</summary>
    public string? PrivateKeyPem { get; set; }

    /// <summary>Base64, at least 32 bytes: keys the App Account Token given to StoreKit. Its own secret.</summary>
    public string? AccountTokenKey { get; set; }

    /// <summary>Base64, exactly 32 bytes: seals the stored original-transaction handle. Its own secret.</summary>
    public string? HandleEncryptionKey { get; set; }
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
    /// <summary>Apple billing is validated independently (like Google): disabled = nothing required; enabled = everything required and the keys distinct.</summary>
    public static void ValidateApple(BillingOptions options)
    {
        var apple = options.Apple;
        if (!apple.Enabled)
        {
            return;
        }

        static void Require(string? value, string setting)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException($"{setting} is required when Billing:Apple:Enabled is true.");
            }
        }

        Require(apple.BundleId, "Billing:Apple:BundleId");
        Require(apple.IssuerId, "Billing:Apple:IssuerId");
        Require(apple.KeyId, "Billing:Apple:KeyId");
        Require(apple.PrivateKeyPem, "Billing:Apple:PrivateKeyPem");
        if (apple.ProductIds.Count == 0 || apple.ProductIds.Any(string.IsNullOrWhiteSpace))
        {
            throw new InvalidOperationException("Billing:Apple:ProductIds is required when Billing:Apple:Enabled is true (the monthly and yearly product ids).");
        }

        if (!TrialIdentityHasher.TryDecodeKey(apple.AccountTokenKey, out _))
        {
            throw new InvalidOperationException(
                $"Billing:Apple:AccountTokenKey is required when Billing:Apple:Enabled is true: a Base64 value of at least {BillingOptions.MinimumHashKeyBytes} bytes.");
        }

        if (!PurchaseTokenProtector.TryDecodeKey(apple.HandleEncryptionKey, out _))
        {
            throw new InvalidOperationException("Billing:Apple:HandleEncryptionKey is required when Billing:Apple:Enabled is true: a Base64 value of exactly 32 bytes.");
        }

        var secrets = new[] { apple.AccountTokenKey, apple.HandleEncryptionKey, options.Google.AccountHashKey, options.Google.PurchaseTokenEncryptionKey, options.TrialIdentityHashKey }
            .Where(secret => !string.IsNullOrWhiteSpace(secret))
            .ToList();
        if (secrets.Count != secrets.Distinct(StringComparer.Ordinal).Count())
        {
            throw new InvalidOperationException("The billing secrets (Apple and Google keys, Billing:TrialIdentityHashKey) must each be a distinct value.");
        }
    }

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
        if (google.AllowedBasePlanIds.Count == 0)
        {
            throw new InvalidOperationException("Billing:Google:BasePlanId (or Billing:Google:BasePlanIds) is required when Billing:Google:Enabled is true.");
        }

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
