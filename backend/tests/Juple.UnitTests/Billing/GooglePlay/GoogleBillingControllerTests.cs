using System.Reflection;
using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.UnitTests.Billing.GooglePlay;

public sealed class GoogleBillingControllerTests
{
    private sealed class FixedIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FixedUser(bool bootstrapped = true) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            bootstrapped ? Task.FromResult(new CurrentJupleUser(7, "UTC", UserPlan.Free)) : throw new CurrentJupleUserNotFoundException();
    }

    private sealed class ScriptedService : IGoogleBillingService
    {
        public Exception? Failure { get; set; }

        public long? LastUserId { get; private set; }

        public Task<GoogleCatalog> GetCatalogAsync(long userId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Failure is null ? Task.FromResult(new GoogleCatalog(true, "juple_monthly", "monthly", "opaque-key")) : throw Failure;
        }

        public Task<GoogleVerifyResult> VerifyAsync(long userId, string purchaseToken, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Failure is null ? Task.FromResult(new GoogleVerifyResult(GoogleVerifyOutcome.Verified, StorePurchaseState.GracePeriod, true)) : throw Failure;
        }

        public Task<GoogleRestoreResult> RestoreAsync(long userId, IReadOnlyList<string> purchaseTokens, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Failure is null ? Task.FromResult(new GoogleRestoreResult(GoogleRestoreOutcome.BelongsToAnotherJupleAccount)) : throw Failure;
        }
    }

    private static GoogleBillingController Controller(ScriptedService service, bool bootstrapped = true) =>
        new(new FixedIdentity(), new FixedUser(bootstrapped), service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static string Code(IActionResult result) =>
        (string)((ProblemDetails)((ObjectResult)result).Value!).Extensions["code"]!;

    [Fact]
    public async Task Catalog_ReturnsOnlyTheNonSecretPurchaseConfiguration()
    {
        var service = new ScriptedService();

        var result = await Controller(service).GetCatalogAsync(CancellationToken.None);

        var body = Assert.IsType<GoogleBillingController.CatalogResponse>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new GoogleBillingController.CatalogResponse(true, "juple_monthly", "monthly", "opaque-key"), body);
        // The caller is identified by the authenticated principal; the request carries none.
        Assert.Equal(7, service.LastUserId);
        // No price, no user id, no credential in the contract.
        Assert.Equal(["BasePlanId", "Enabled", "ObfuscatedAccountId", "ProductId"], typeof(GoogleBillingController.CatalogResponse).GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(property => property.Name).Order().ToArray());
    }

    [Fact]
    public async Task Verify_ReturnsTheNormalizedResultOnly()
    {
        var result = await Controller(new ScriptedService()).VerifyAsync(new GoogleBillingController.VerifyPurchaseRequest("t"), CancellationToken.None);

        var body = Assert.IsType<GoogleBillingController.VerifyPurchaseResponse>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new GoogleBillingController.VerifyPurchaseResponse("verified", "gracePeriod", true), body);
    }

    [Fact]
    public async Task Restore_ReturnsTheOutcome()
    {
        var result = await Controller(new ScriptedService()).RestoreAsync(new GoogleBillingController.RestorePurchasesRequest(["t"]), CancellationToken.None);

        Assert.Equal("belongsToAnotherJupleAccount", Assert.IsType<GoogleBillingController.RestorePurchasesResponse>(Assert.IsType<OkObjectResult>(result).Value).Outcome);
    }

    [Fact]
    public async Task AccountConflict_Is409WithAStableCode()
    {
        var result = await Controller(new ScriptedService { Failure = new PurchaseBelongsToAnotherAccountException() })
            .VerifyAsync(new GoogleBillingController.VerifyPurchaseRequest("t"), CancellationToken.None);

        Assert.Equal(409, ((ObjectResult)result).StatusCode);
        Assert.Equal("purchaseBelongsToAnotherAccount", Code(result));
    }

    [Theory]
    [InlineData(typeof(PurchaseNotAllowedException), 400, "purchaseNotAllowed")]
    [InlineData(typeof(GooglePlayPurchaseNotFoundException), 400, "invalidPurchaseToken")]
    [InlineData(typeof(GooglePlayUnavailableException), 503, "storeUnavailable")]
    [InlineData(typeof(GooglePlayMalformedResponseException), 503, "storeUnavailable")]
    [InlineData(typeof(BillingNotEnabledException), 409, "googleBillingNotEnabled")]
    public async Task EveryFailure_HasAStatusAndACode_AndNeverALeak(Type failure, int status, string code)
    {
        Exception exception = failure == typeof(PurchaseNotAllowedException)
            ? new PurchaseNotAllowedException(PurchaseRejectionReason.Product)
            : failure == typeof(GooglePlayUnavailableException)
                ? new GooglePlayUnavailableException("detail that must not leak")
                : failure == typeof(GooglePlayMalformedResponseException)
                    ? new GooglePlayMalformedResponseException("detail that must not leak")
                    : (Exception)Activator.CreateInstance(failure)!;

        var result = await Controller(new ScriptedService { Failure = exception }).VerifyAsync(new GoogleBillingController.VerifyPurchaseRequest("t"), CancellationToken.None);

        Assert.Equal(status, ((ObjectResult)result).StatusCode);
        Assert.Equal(code, Code(result));
        Assert.DoesNotContain("detail that must not leak", ((ProblemDetails)((ObjectResult)result).Value!).Title ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnAccountThatIsNotBootstrapped_Gets409()
    {
        var result = await Controller(new ScriptedService(), bootstrapped: false).GetCatalogAsync(CancellationToken.None);

        Assert.Equal(409, ((ObjectResult)result).StatusCode);
    }

    [Fact]
    public void TheControllerIsAuthenticated_RateLimited_AndUsableWhileExpired()
    {
        var type = typeof(GoogleBillingController);

        Assert.NotNull(type.GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        Assert.NotNull(type.GetCustomAttribute<EnableRateLimitingAttribute>());
        Assert.NotNull(type.GetCustomAttribute<Juple.Api.Billing.AllowWhenSubscriptionExpiredAttribute>());
    }

    [Fact]
    public void TheWebhookIsAnonymous_AndHasNoIpBasedRateLimit_SoGoogleRetriesAreNeverThrottled()
    {
        var type = typeof(GoogleRtdnController);

        Assert.NotNull(type.GetCustomAttribute<Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<EnableRateLimitingAttribute>());
        Assert.Null(type.GetMethod(nameof(GoogleRtdnController.ReceiveAsync))!.GetCustomAttribute<EnableRateLimitingAttribute>());
    }
}

public sealed class EntitlementServiceWithPurchasesTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly TrialWindow Ended = new(Now.AddDays(-80), Now.AddDays(-50));

    private sealed class Store(params PurchaseAccess[] purchases) : IEntitlementStore
    {
        public Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<EntitlementUserState?>(new EntitlementUserState(userId, Now.AddDays(-90), Ended.StartedAtUtc, Ended.EndsAtUtc, null));

        public Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            GetUserStateAsync(1, cancellationToken);

        public Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PurchaseAccess>>(purchases);

        public Task<TrialWindow> EnsureTrialAsync(long userId, byte[] identityHash, TrialWindow newWindow, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private static EntitlementService Service(BillingOptions options, params PurchaseAccess[] purchases) =>
        new(options, new Store(purchases), new TrialIdentityHasher(options), new StubTime(Now));

    private static BillingOptions Enabled() => new() { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch, TrialIdentityHashKey = GoogleTestData.Key32 };

    [Fact]
    public async Task APaidPurchaseMakesAnExpiredTrialAccountActive()
    {
        var result = await Service(Enabled(), new PurchaseAccess(StorePurchaseState.Active, EntitlementReason.None, Now.AddDays(5))).GetForUserAsync(1);

        Assert.Equal(EntitlementStatus.Active, result.Status);
        Assert.True(result.CanWrite);
    }

    [Fact]
    public async Task WithoutALivePurchase_TheAccountIsExpired_FrozenWhereAccessEnded()
    {
        var result = await Service(Enabled(), new PurchaseAccess(StorePurchaseState.OnHold, EntitlementReason.BillingIssue, Now.AddDays(-2))).GetForUserAsync(1);

        Assert.Equal(EntitlementStatus.Expired, result.Status);
        Assert.Equal(Now.AddDays(-2), result.AccessFrozenAtUtc);
    }

    [Fact]
    public async Task WhileTheProgramIsNotLaunched_PurchasesAreNotEvenRead()
    {
        var result = await Service(new BillingOptions(), new PurchaseAccess(StorePurchaseState.Active, EntitlementReason.None, Now.AddDays(5))).GetForUserAsync(1);

        Assert.False(result.ProgramEnabled);
        Assert.Null(result.Status);
    }
}
