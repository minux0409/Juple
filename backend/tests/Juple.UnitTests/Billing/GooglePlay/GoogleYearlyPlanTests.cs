using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing.GooglePlay;

/// <summary>The monthly and the yearly base plans of the ONE membership subscription: both allowlisted, nothing else, and the old single-plan setting still works.</summary>
public sealed class GoogleYearlyPlanTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private const long UserA = 101;
    private const string Token = "token-yearly-0123456789";

    private sealed class Harness
    {
        public Harness(Action<BillingOptions>? configure = null)
        {
            Options = GoogleTestData.Options();
            configure?.Invoke(Options);
            Accounts = new GoogleAccountIdProvider(Options);
            Service = new GoogleBillingService(Options, Google, Store, Accounts, new PurchaseTokenProtector(Options), new FakeTelemetry(), Time);
        }

        public BillingOptions Options { get; }
        public FakeGooglePlayClient Google { get; } = new();
        public FakeGoogleBillingStore Store { get; } = new();
        public StubTime Time { get; } = new(Now);
        public GoogleAccountIdProvider Accounts { get; }
        public GoogleBillingService Service { get; }

        public void Set(string basePlan, DateTimeOffset expiry) =>
            Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, Accounts.Compute(UserA), expiry, basePlanId: basePlan));
    }

    [Fact]
    public async Task Catalog_ListsBothBasePlans_AndKeepsTheFirstInTheLegacyField()
    {
        var harness = new Harness(options => options.Google.BasePlanIds = ["monthly", "yearly"]);

        var catalog = await harness.Service.GetCatalogAsync(UserA);

        Assert.Equal(["monthly", "yearly"], catalog.BasePlanIds);
        Assert.Equal("monthly", catalog.BasePlanId);
    }

    [Fact]
    public async Task Catalog_AnExistingDeploymentThatOnlySetsTheSinglePlan_IsUnchanged()
    {
        var harness = new Harness();

        var catalog = await harness.Service.GetCatalogAsync(UserA);

        Assert.Equal([GoogleTestData.BasePlanId], catalog.BasePlanIds);
        Assert.Equal(GoogleTestData.BasePlanId, catalog.BasePlanId);
    }

    [Fact]
    public async Task Verify_AcceptsTheYearlyPlan_WhenItIsAllowlisted()
    {
        var harness = new Harness(options => options.Google.BasePlanIds = ["monthly", "yearly"]);
        harness.Set("yearly", Now.AddDays(365));

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(Now.AddDays(365), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task Verify_RefusesTheYearlyPlan_WhenOnlyMonthlyIsAllowlisted()
    {
        var harness = new Harness();
        harness.Set("yearly", Now.AddDays(365));

        var exception = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, Token));

        Assert.Equal(PurchaseRejectionReason.Product, exception.Reason);
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Verify_RefusesAnUnknownBasePlan_EvenWithBothAllowlisted()
    {
        var harness = new Harness(options => options.Google.BasePlanIds = ["monthly", "yearly"]);
        harness.Set("weekly", Now.AddDays(7));

        await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, Token));
    }

    [Fact]
    public void Validator_AcceptsEitherTheSinglePlanOrTheList_ButNeitherIsAnError()
    {
        var withList = GoogleTestData.Options();
        withList.Google.BasePlanId = null;
        withList.Google.BasePlanIds = ["monthly", "yearly"];
        BillingOptionsValidator.ValidateGoogle(withList);

        var none = GoogleTestData.Options();
        none.Google.BasePlanId = null;
        none.Google.BasePlanIds = [];
        var exception = Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.ValidateGoogle(none));
        Assert.Contains("BasePlanId", exception.Message);
    }

    [Fact]
    public void AllowedBasePlanIds_IsDistinctTrimmedAndWithoutBlanks()
    {
        var options = new GoogleBillingOptions { BasePlanId = " monthly ", BasePlanIds = ["monthly", "", "yearly", "yearly"] };

        Assert.Equal(["monthly", "yearly"], options.AllowedBasePlanIds);
    }
}
