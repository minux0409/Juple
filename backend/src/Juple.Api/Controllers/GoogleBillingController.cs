using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Billing.GooglePlay;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in app's side of Google Play billing: what to purchase, "verify this purchase", and "restore". Usable while the
/// subscription is expired (that is exactly when someone subscribes). The owner is always the internal user id from the authenticated
/// principal; the client supplies a purchase token and nothing else it could lie about - not a price, an expiry, a state, a package,
/// a user or an entitlement. Everything is fetched from Google and checked server-side (see GoogleBillingService).
/// </summary>
[ApiController]
[Route("api/v1/billing/google")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
[EnableRateLimiting(RateLimitPolicies.BillingGoogle)]
public sealed class GoogleBillingController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IGoogleBillingService billing) : ControllerBase
{
    public const string PurchaseBelongsToAnotherAccountCode = "purchaseBelongsToAnotherAccount";
    public const string PurchaseNotAllowedCode = "purchaseNotAllowed";
    public const string InvalidPurchaseTokenCode = "invalidPurchaseToken";
    public const string StoreUnavailableCode = "storeUnavailable";
    public const string BillingNotEnabledCode = "googleBillingNotEnabled";

    /// <summary>
    /// The non-secret configuration the app needs to start a purchase. Disabled: enabled=false and no identifiers at all. It never carries a
    /// price (the app asks Google Play for the localized one), the internal user id, a credential or a token. The obfuscated account id is
    /// the opaque id this account must pass to Google so the purchase can be tied back to it.
    /// </summary>
    [HttpGet("catalog")]
    public Task<IActionResult> GetCatalogAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.GetCatalogAsync(userId, cancellationToken),
            catalog => Ok(new CatalogResponse(catalog.Enabled, catalog.ProductId, catalog.BasePlanId, catalog.ObfuscatedAccountId)),
            cancellationToken);

    [HttpPost("verify")]
    public Task<IActionResult> VerifyAsync([FromBody] VerifyPurchaseRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.VerifyAsync(userId, request.PurchaseToken, cancellationToken),
            result => Ok(new VerifyPurchaseResponse(ToWire(result.Outcome), ToWire(result.State), result.Acknowledged)),
            cancellationToken);

    /// <summary>Restore: the tokens Google Play reports the device holds are each verified server-side (never trusted); with none, the account's own known purchases are refreshed from Google.</summary>
    [HttpPost("restore")]
    public Task<IActionResult> RestoreAsync([FromBody] RestorePurchasesRequest? request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.RestoreAsync(userId, request?.PurchaseTokens ?? [], cancellationToken),
            result => Ok(new RestorePurchasesResponse(ToWire(result.Outcome))),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync<T>(Func<long, Task<T>> operation, Func<T, IActionResult> ok, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
            return ok(await operation(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (BillingNotEnabledException)
        {
            return CollectionProblems.Create(StatusCodes.Status409Conflict, "Google Play billing is not enabled.", BillingNotEnabledCode);
        }
        catch (PurchaseBelongsToAnotherAccountException)
        {
            return CollectionProblems.Create(StatusCodes.Status409Conflict, "This purchase belongs to another Juple account.", PurchaseBelongsToAnotherAccountCode);
        }
        catch (PurchaseNotAllowedException)
        {
            return CollectionProblems.Create(StatusCodes.Status400BadRequest, "This purchase cannot be used for Juple.", PurchaseNotAllowedCode);
        }
        catch (GooglePlayPurchaseNotFoundException)
        {
            return CollectionProblems.Create(StatusCodes.Status400BadRequest, "The purchase could not be found.", InvalidPurchaseTokenCode);
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException)
        {
            Response.Headers.RetryAfter = "30";
            return CollectionProblems.Create(StatusCodes.Status503ServiceUnavailable, "The store could not be reached. Try again shortly.", StoreUnavailableCode);
        }
    }

    private static string ToWire(GoogleVerifyOutcome outcome) => outcome switch
    {
        GoogleVerifyOutcome.Verified => "verified",
        GoogleVerifyOutcome.Pending => "pending",
        _ => "notEntitled",
    };

    private static string ToWire(StorePurchaseState state) => state switch
    {
        StorePurchaseState.Pending => "pending",
        StorePurchaseState.Active => "active",
        StorePurchaseState.GracePeriod => "gracePeriod",
        StorePurchaseState.Canceled => "canceled",
        StorePurchaseState.OnHold => "onHold",
        StorePurchaseState.Paused => "paused",
        StorePurchaseState.Revoked => "revoked",
        _ => "expired",
    };

    private static string ToWire(GoogleRestoreOutcome outcome) => outcome switch
    {
        GoogleRestoreOutcome.Restored => "restored",
        GoogleRestoreOutcome.BelongsToAnotherJupleAccount => "belongsToAnotherJupleAccount",
        GoogleRestoreOutcome.TemporaryFailure => "temporaryFailure",
        _ => "nothingFound",
    };

    public sealed record CatalogResponse(bool Enabled, string? ProductId, string? BasePlanId, string? ObfuscatedAccountId);

    public sealed record VerifyPurchaseRequest(string PurchaseToken);

    /// <summary>The normalized result only - the app then refreshes bootstrap for the effective entitlement. No Google state, token or price.</summary>
    public sealed record VerifyPurchaseResponse(string Outcome, string State, bool Acknowledged);

    public sealed record RestorePurchasesRequest(IReadOnlyList<string>? PurchaseTokens);

    public sealed record RestorePurchasesResponse(string Outcome);
}
