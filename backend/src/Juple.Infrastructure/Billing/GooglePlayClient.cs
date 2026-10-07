using System.Net;
using Google;
using Google.Apis.AndroidPublisher.v3;
using Google.Apis.AndroidPublisher.v3.Data;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;

namespace Juple.Infrastructure.Billing;

/// <summary>
/// Where the Google API credential comes from. The billing services only ever ask for "a Play client"; today that is a service-account
/// key read from configuration (a Key Vault-backed Container Apps secret when deployed), and a stronger source - for example workload
/// identity federation with no long-lived key - replaces this one without touching any billing service.
/// </summary>
public interface IGoogleCredentialSource
{
    GoogleCredential GetCredential();
}

/// <summary>The first-release credential: the service-account JSON in <c>Billing:Google:ServiceAccountCredentialJson</c>. Never logged.</summary>
public sealed class ConfiguredServiceAccountCredentialSource(BillingOptions options) : IGoogleCredentialSource
{
    public GoogleCredential GetCredential()
    {
        var json = options.Google.ServiceAccountCredentialJson;
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new InvalidOperationException("Billing:Google:ServiceAccountCredentialJson is not configured.");
        }

        return CredentialFactory.FromJson<ServiceAccountCredential>(json)
            .ToGoogleCredential()
            .CreateScoped(AndroidPublisherService.Scope.Androidpublisher);
    }
}

/// <summary>
/// The only place that talks to the Google Play Developer API: <c>purchases.subscriptionsv2.get</c> for the authoritative state and
/// <c>purchases.subscriptions.acknowledge</c> (the acknowledgement call Google still provides) - through the official client, never by
/// hand-parsing a response. Everything is mapped to Juple's own snapshot (see <see cref="GoogleSubscriptionMapper"/>); a failure is one of
/// three typed outcomes so callers never depend on Google's exception types.
/// </summary>
public sealed class GooglePlayClient(IGoogleCredentialSource credentials) : IGooglePlayClient, IDisposable
{
    private readonly Lazy<AndroidPublisherService> _service = new(() => new AndroidPublisherService(new BaseClientService.Initializer
    {
        HttpClientInitializer = credentials.GetCredential(),
        ApplicationName = "Juple",
    }));

    public async Task<GoogleSubscriptionSnapshot> GetSubscriptionAsync(string packageName, string purchaseToken, string expectedProductId, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _service.Value.Purchases.Subscriptionsv2.Get(packageName, purchaseToken).ExecuteAsync(cancellationToken);
            return GoogleSubscriptionMapper.Map(response, expectedProductId);
        }
        catch (GoogleApiException exception)
        {
            throw Translate(exception);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or TimeoutException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new GooglePlayUnavailableException("The Google Play request did not complete.", exception);
        }
    }

    public async Task AcknowledgeAsync(string packageName, string productId, string purchaseToken, CancellationToken cancellationToken = default)
    {
        try
        {
            await _service.Value.Purchases.Subscriptions
                .Acknowledge(new SubscriptionPurchasesAcknowledgeRequest(), packageName, productId, purchaseToken)
                .ExecuteAsync(cancellationToken);
        }
        catch (GoogleApiException exception)
        {
            throw Translate(exception);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or TimeoutException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new GooglePlayUnavailableException("The Google Play request did not complete.", exception);
        }
    }

    /// <summary>
    /// 404 / 410 (and 400 for a token Google cannot parse) mean the purchase is not known; every other failure - throttling, 5xx and
    /// also 401/403, a credential or permission problem an operator must fix - is "unavailable, retry later" so a configuration fault never
    /// silently refuses or grants anyone.
    /// </summary>
    private static Exception Translate(GoogleApiException exception) => exception.HttpStatusCode switch
    {
        HttpStatusCode.NotFound or HttpStatusCode.Gone or HttpStatusCode.BadRequest => new GooglePlayPurchaseNotFoundException(),
        _ => new GooglePlayUnavailableException($"Google Play answered {(int)exception.HttpStatusCode}.", exception),
    };

    public void Dispose()
    {
        if (_service.IsValueCreated)
        {
            _service.Value.Dispose();
        }
    }
}

/// <summary>Picks the allowlisted product's line item out of a <c>SubscriptionPurchaseV2</c> and normalizes it. Pure and offline: the whole mapping is unit-testable.</summary>
public static class GoogleSubscriptionMapper
{
    public static GoogleSubscriptionSnapshot Map(SubscriptionPurchaseV2 response, string expectedProductId)
    {
        var lineItem = (response.LineItems ?? [])
            .FirstOrDefault(item => string.Equals(item.ProductId, expectedProductId, StringComparison.Ordinal))
            ?? (response.LineItems ?? []).FirstOrDefault()
            ?? throw new GooglePlayMalformedResponseException("The subscription has no line items.");

        if (string.IsNullOrEmpty(lineItem.ProductId))
        {
            throw new GooglePlayMalformedResponseException("The line item has no product id.");
        }

        var planType = lineItem.AutoRenewingPlan is not null
            ? GooglePlanType.AutoRenewing
            : lineItem.PrepaidPlan is not null
                ? GooglePlanType.Prepaid
                : throw new GooglePlayMalformedResponseException("The line item is neither auto-renewing nor prepaid.");

        var cancel = response.CanceledStateContext;
        var cancelSource = cancel is null
            ? GoogleCancelSource.None
            : cancel.DeveloperInitiatedCancellation is not null
                ? GoogleCancelSource.Developer
                : cancel.SystemInitiatedCancellation is not null
                    ? GoogleCancelSource.System
                    : cancel.UserInitiatedCancellation is not null
                        ? GoogleCancelSource.User
                        : cancel.ReplacementCancellation is not null ? GoogleCancelSource.Replaced : GoogleCancelSource.None;

        return new GoogleSubscriptionSnapshot(
            MapState(response.SubscriptionState),
            lineItem.ProductId,
            lineItem.OfferDetails?.BasePlanId,
            planType,
            ToUtc(response.StartTimeDateTimeOffset),
            ToUtc(lineItem.ExpiryTimeDateTimeOffset),
            lineItem.AutoRenewingPlan?.AutoRenewEnabled ?? false,
            string.Equals(response.AcknowledgementState, "ACKNOWLEDGEMENT_STATE_PENDING", StringComparison.Ordinal),
            string.IsNullOrEmpty(response.ExternalAccountIdentifiers?.ObfuscatedExternalAccountId) ? null : response.ExternalAccountIdentifiers.ObfuscatedExternalAccountId,
            string.IsNullOrEmpty(response.LinkedPurchaseToken) ? null : response.LinkedPurchaseToken,
            cancelSource,
            response.TestPurchase is not null);
    }

    public static GoogleSubscriptionState MapState(string? state) => state switch
    {
        "SUBSCRIPTION_STATE_PENDING" => GoogleSubscriptionState.Pending,
        "SUBSCRIPTION_STATE_ACTIVE" => GoogleSubscriptionState.Active,
        "SUBSCRIPTION_STATE_PAUSED" => GoogleSubscriptionState.Paused,
        "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" => GoogleSubscriptionState.InGracePeriod,
        "SUBSCRIPTION_STATE_ON_HOLD" => GoogleSubscriptionState.OnHold,
        "SUBSCRIPTION_STATE_CANCELED" => GoogleSubscriptionState.Canceled,
        "SUBSCRIPTION_STATE_EXPIRED" => GoogleSubscriptionState.Expired,
        "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED" => GoogleSubscriptionState.PendingPurchaseCanceled,
        _ => throw new GooglePlayMalformedResponseException("Unknown or missing subscription state."),
    };

    private static DateTimeOffset? ToUtc(DateTimeOffset? value) => value?.ToUniversalTime();
}
