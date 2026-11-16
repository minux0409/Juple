using Juple.Application.Billing;

namespace Juple.UnitTests.Billing;

/// <summary>
/// Offering the purchase is separate from starting existing members' free month and from the read-only restriction: a preview account
/// (App Review, internal testers) is offered the membership before the launch, and nothing else changes for anyone.
/// </summary>
public sealed class MembershipOfferTests
{
    private const long Preview = 101;
    private const long Member = 303;

    [Fact]
    public void BeforeTheLaunch_OnlyThePreviewAccountsAreOffered()
    {
        var options = new BillingOptions { PurchasePreviewUserIds = [Preview] };

        Assert.True(MembershipOffer.IsOffered(options, Preview));
        Assert.False(MembershipOffer.IsOffered(options, Member));
        Assert.False(MembershipOffer.IsOffered(new BillingOptions(), Preview));
    }

    [Fact]
    public void OnceTheProgramIsLaunched_EveryoneIsOffered()
    {
        Assert.True(MembershipOffer.IsOffered(new BillingOptions { ProgramEnabled = true }, Member));
    }

    [Fact]
    public void APreviewNeverStartsATrialOrRestrictsAnyone_TheEntitlementStaysProgramOff()
    {
        var options = new BillingOptions { PurchasePreviewUserIds = [Preview] };

        // The write gate and the trial both read ProgramEnabled only.
        Assert.False(options.ProgramEnabled);
        Assert.Null(options.ProgramStartAtUtc);
        BillingOptionsValidator.Validate(options);
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-5L)]
    public void APreviewIdMustBeAnInternalUserId(long id)
    {
        Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.Validate(new BillingOptions { PurchasePreviewUserIds = [id] }));
    }
}
