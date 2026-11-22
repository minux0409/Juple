using System.Reflection;
using Juple.Api.Controllers;
using Juple.Api.Safety;
using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Juple.Application.Billing.GooglePlay;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;

namespace Juple.UnitTests.Safety;

public sealed class SubscriptionManagementTests
{
    [Theory]
    [InlineData("2026-10-14", "2026-10-14", 200)]
    [InlineData("2099-01-01", "2099-01-01", 503)]
    [InlineData("2026-10-25", "2099-01-01", 409)]
    public void UnknownOrStaleDocumentPolicyDoesNotFallBackToAnotherVersion(string current, string requested, int expected)
    {
        var controller = new TermsDocumentController(new TermsOptions { CurrentVersion = current })
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var response = Assert.IsAssignableFrom<ObjectResult>(controller.Get(requested, "ko"));
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
    }

    public class Stub : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> InvokeMethod = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => InvokeMethod(method!, args);
    }
    private static T Mock<T>(Func<MethodInfo, object?[]?, object?> invoke) where T : class
    {
        var instance = DispatchProxy.Create<T, Stub>();
        ((Stub)(object)instance).InvokeMethod = invoke;
        return instance;
    }
    private static SubscriptionManagementController Controller(Action<string>? restored = null)
    {
        var principal = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        return new(
            Mock<IExternalIdentityAccessor>((_, _) => principal),
            Mock<ICurrentJupleUserAccessor>((_, _) => Task.FromResult(new CurrentJupleUser(7, "UTC", default))),
            Mock<IEntitlementService>((method, args) => {
                Assert.Equal(nameof(IEntitlementService.GetStoreSubscriptionForIdentityAsync), method.Name);
                Assert.Equal(principal, args![0]);
                return Task.FromResult(StoreSubscriptionOwnership.None);
            }),
            Mock<IGoogleBillingService>((method, args) => {
                Assert.Equal("RestoreAsync", method.Name); Assert.Equal(7L, args![0]);
                Assert.Empty(Assert.IsAssignableFrom<IEnumerable<string>>(args[1])); restored?.Invoke("google");
                return Task.FromResult(new GoogleRestoreResult(GoogleRestoreOutcome.NothingFound));
            }),
            Mock<IAppleBillingService>((method, args) => {
                Assert.Equal("RestoreAsync", method.Name); Assert.Equal(7L, args![0]);
                Assert.Empty(Assert.IsAssignableFrom<IEnumerable<string>>(args[1])); restored?.Invoke("apple");
                return Task.FromResult(new AppleRestoreResult(AppleRestoreOutcome.NothingFound));
            }));
    }

    [Fact]
    public async Task StatusNeverSettlesTrialOrAcceptsTerms() => Assert.IsType<OkObjectResult>(await Controller().Get(default));

    [Theory]
    [InlineData("google")]
    [InlineData("apple")]
    public async Task RestoreOnlyRefreshesTheAuthenticatedUsersKnownPurchases(string platform)
    {
        var calls = new List<string>();
        Assert.IsType<OkObjectResult>(await Controller(calls.Add).Restore(platform, default));
        Assert.Equal([platform], calls);
        // No client token/body parameter exists: new purchase handles cannot be claimed through this exception.
        Assert.Equal([typeof(string), typeof(CancellationToken)], typeof(SubscriptionManagementController).GetMethod("Restore")!.GetParameters().Select(p => p.ParameterType));
    }

    [Fact]
    public async Task UnknownStoreDoesNotCallEitherProcessor() => Assert.IsType<BadRequestResult>(await Controller(_ => Assert.Fail()).Restore("other", default));

    [Theory]
    [InlineData(typeof(GoogleBillingController))]
    [InlineData(typeof(AppleBillingController))]
    public void PurchaseAndTokenClaimEndpointsCannotUseTheManagementException(Type controller)
    {
        foreach (var method in new[] { "GetCatalogAsync", "VerifyAsync", "RestoreAsync" })
        {
            Assert.NotNull(controller.GetMethod(method)!.GetCustomAttribute<RequireCurrentTermsAcceptanceAttribute>());
            Assert.Null(controller.GetMethod(method)!.GetCustomAttribute<AllowWithoutTermsAcceptanceAttribute>());
        }
        Assert.NotNull(typeof(SubscriptionManagementController).GetCustomAttribute<AllowWithoutTermsAcceptanceAttribute>());
    }
}
