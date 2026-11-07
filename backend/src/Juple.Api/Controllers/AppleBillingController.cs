using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Billing.Apple;
using Juple.Application.Billing.GooglePlay;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in app's side of App Store billing: what to purchase (product ids + this account's App Account Token), "verify this
/// transaction" and "restore". Usable while the subscription is expired (that is exactly when someone subscribes). The owner is always the
/// internal user id from the authenticated principal; the client supplies a signed transaction and nothing else it could lie about - its
/// Apple signature is verified, then everything (state, expiry, product, account token) is read again from the App Store Server API.
/// </summary>
[ApiController]
[Route("api/v1/billing/apple")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
[EnableRateLimiting(RateLimitPolicies.BillingApple)]
public sealed class AppleBillingController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IAppleBillingService billing) : ControllerBase
{
    public const string PurchaseBelongsToAnotherAccountCode = "purchaseBelongsToAnotherAccount";
    public const string PurchaseNotAllowedCode = "purchaseNotAllowed";
    public const string InvalidTransactionCode = "invalidTransaction";
    public const string StoreUnavailableCode = "storeUnavailable";
    public const string BillingNotEnabledCode = "appleBillingNotEnabled";

    /// <summary>Disabled: enabled=false and no identifiers. Never a price (the app asks the App Store for the localized one), a user id, a credential or a token.</summary>
    [HttpGet("catalog")]
    public Task<IActionResult> GetCatalogAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.GetCatalogAsync(userId, cancellationToken),
            catalog => Ok(new CatalogResponse(catalog.Enabled, catalog.ProductIds, catalog.AppAccountToken?.ToString("D"))),
            cancellationToken);

    [HttpPost("verify")]
    public Task<IActionResult> VerifyAsync([FromBody] VerifyTransactionRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.VerifyAsync(userId, request.SignedTransaction, cancellationToken),
            result => Ok(new VerifyTransactionResponse(ToWire(result.Outcome), ToWire(result.State))),
            cancellationToken);

    [HttpPost("restore")]
    public Task<IActionResult> RestoreAsync([FromBody] RestoreTransactionsRequest? request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => billing.RestoreAsync(userId, request?.SignedTransactions ?? [], cancellationToken),
            result => Ok(new RestoreTransactionsResponse(ToWire(result.Outcome))),
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
            return CollectionProblems.Create(StatusCodes.Status409Conflict, "App Store billing is not enabled.", BillingNotEnabledCode);
        }
        catch (PurchaseBelongsToAnotherAccountException)
        {
            return CollectionProblems.Create(StatusCodes.Status409Conflict, "This purchase belongs to another Juple account.", PurchaseBelongsToAnotherAccountCode);
        }
        catch (PurchaseNotAllowedException)
        {
            return CollectionProblems.Create(StatusCodes.Status400BadRequest, "This purchase cannot be used for Juple.", PurchaseNotAllowedCode);
        }
        catch (Exception exception) when (exception is AppleSignatureException or AppleMalformedException or AppleTransactionNotFoundException)
        {
            return CollectionProblems.Create(StatusCodes.Status400BadRequest, "The transaction could not be verified.", InvalidTransactionCode);
        }
        catch (AppleUnavailableException)
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

    private static string ToWire(AppleRestoreOutcome outcome) => outcome switch
    {
        AppleRestoreOutcome.Restored => "restored",
        AppleRestoreOutcome.BelongsToAnotherJupleAccount => "belongsToAnotherJupleAccount",
        AppleRestoreOutcome.TemporaryFailure => "temporaryFailure",
        _ => "nothingFound",
    };

    public sealed record CatalogResponse(bool Enabled, IReadOnlyList<string> ProductIds, string? AppAccountToken);

    public sealed record VerifyTransactionRequest(string SignedTransaction);

    /// <summary>The normalized result only - the app then refreshes bootstrap for the effective entitlement. No Apple state, token or price.</summary>
    public sealed record VerifyTransactionResponse(string Outcome, string State);

    public sealed record RestoreTransactionsRequest(IReadOnlyList<string>? SignedTransactions);

    public sealed record RestoreTransactionsResponse(string Outcome);
}
