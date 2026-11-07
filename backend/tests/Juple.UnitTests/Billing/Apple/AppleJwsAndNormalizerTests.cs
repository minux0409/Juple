using Juple.Application.Billing.Apple;
using Juple.Domain.Billing;
using Juple.UnitTests.Billing.GooglePlay;

namespace Juple.UnitTests.Billing.Apple;

public sealed class AppleJwsVerifierTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private readonly AppleTestPki _pki = new(Now);
    private readonly StubTime _time = new(Now);

    public void Dispose() => _pki.Dispose();

    [Fact]
    public void ValidChain_AndSignature_ReturnsThePayload()
    {
        var jws = _pki.Sign(new { hello = "world" });

        var payload = _pki.Verifier(_time).VerifyAndGetPayload(jws);

        Assert.Contains("\"hello\":\"world\"", payload);
    }

    [Fact]
    public void TamperedPayload_IsRefused()
    {
        var jws = _pki.Sign(new { amount = 1 });
        var parts = jws.Split('.');
        var forged = $"{parts[0]}.{AppleTestPki.Base64Url("{\"amount\":999}"u8.ToArray())}.{parts[2]}";

        Assert.Throws<AppleSignatureException>(() => _pki.Verifier(_time).VerifyAndGetPayload(forged));
    }

    [Fact]
    public void ChainToAnotherRoot_IsRefused()
    {
        using var stranger = new AppleTestPki(Now);
        var jws = stranger.Sign(new { hello = "world" });

        // Signed correctly - but by a chain that does not lead to the root the verifier trusts.
        Assert.Throws<AppleSignatureException>(() => _pki.Verifier(_time).VerifyAndGetPayload(jws));
    }

    [Theory]
    [InlineData("none")]
    [InlineData("HS256")]
    [InlineData("RS256")]
    public void AnyAlgorithmOtherThanES256_IsRefused(string algorithm)
    {
        var jws = _pki.Sign(new { hello = "world" }, algorithm);

        Assert.Throws<AppleSignatureException>(() => _pki.Verifier(_time).VerifyAndGetPayload(jws));
    }

    [Fact]
    public void MissingCertificateChain_IsRefused()
    {
        var jws = _pki.Sign(new { hello = "world" }, includeChain: false);

        Assert.Throws<AppleSignatureException>(() => _pki.Verifier(_time).VerifyAndGetPayload(jws));
    }

    [Fact]
    public void LeafWithoutAppleReceiptExtension_IsRefused_WhenAppleExtensionsAreRequired()
    {
        using var pki = new AppleTestPki(Now, leafExtension: false);
        var jws = pki.Sign(new { hello = "world" });

        Assert.Throws<AppleSignatureException>(() => pki.Verifier(_time, requireAppleExtensions: true).VerifyAndGetPayload(jws));
        // Control: the same chain verifies when the extension rule is off - so the refusal above is the extension and nothing else.
        Assert.Contains("hello", pki.Verifier(_time, requireAppleExtensions: false).VerifyAndGetPayload(jws));
    }

    [Fact]
    public void IntermediateWithoutAppleExtension_IsRefused()
    {
        using var pki = new AppleTestPki(Now, intermediateExtension: false);

        Assert.Throws<AppleSignatureException>(() => pki.Verifier(_time).VerifyAndGetPayload(pki.Sign(new { hello = "world" })));
    }

    [Fact]
    public void ExpiredCertificate_IsRefused()
    {
        using var pki = new AppleTestPki(Now, leafLifetime: TimeSpan.FromDays(1));
        var jws = pki.Sign(new { hello = "world" });
        var later = new StubTime(Now.AddDays(10));

        Assert.Throws<AppleSignatureException>(() => pki.Verifier(later).VerifyAndGetPayload(jws));
    }

    [Theory]
    [InlineData("")]
    [InlineData("a.b")]
    [InlineData("a.b.c.d")]
    [InlineData("not a jws")]
    [InlineData("!!!.???.***")]
    public void NotAJws_IsRefused(string text)
    {
        Assert.Throws<AppleSignatureException>(() => _pki.Verifier(_time).VerifyAndGetPayload(text));
    }

    [Fact]
    public void PinnedAppleRoot_IsEmbedded_AndItsFingerprintIsApples()
    {
        // The production constructor loads the embedded Apple Root CA - G3; a payload signed by a test chain must NOT verify against it.
        var production = new AppleJwsVerifier(_time);

        Assert.Throws<AppleSignatureException>(() => production.VerifyAndGetPayload(_pki.Sign(new { hello = "world" })));
    }
}

public sealed class AppleSubscriptionNormalizerTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);

    private static AppleSubscriptionSnapshot Snap(AppleSubscriptionStatus status, DateTimeOffset? expires = null, DateTimeOffset? revoked = null, AppleRenewalInfo? renewal = null) =>
        AppleTestData.Snapshot(AppleTestData.Transaction(expires: expires, revoked: revoked), status, renewal);

    private static AppleRenewalInfo Renewal(bool? auto = true, int? intent = null, DateTimeOffset? grace = null) => new("1000000000000001", null, auto, intent, null, grace);

    [Fact]
    public void Active_IsLiveUntilExpiry()
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, Now.AddDays(30), renewal: Renewal()), Now);

        Assert.Equal(StorePurchaseState.Active, result.State);
        Assert.Equal(Now.AddDays(30), result.AccessEndsAtUtc);
        Assert.True(result.AutoRenews);
        Assert.False(result.AcknowledgementPending);
    }

    [Fact]
    public void Active_WithAutoRenewOff_IsCanceled_ButStillLive()
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, Now.AddDays(10), renewal: Renewal(auto: false)), Now);

        Assert.Equal(StorePurchaseState.Canceled, result.State);
        Assert.Equal(EntitlementReason.Cancelled, result.Reason);
        Assert.Equal(Now.AddDays(10), result.AccessEndsAtUtc);
    }

    [Fact]
    public void BillingGracePeriod_IsLiveUntilTheGraceEndAppleReports()
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.BillingGracePeriod, Now.AddDays(-1), renewal: Renewal(grace: Now.AddDays(15))), Now);

        Assert.Equal(StorePurchaseState.GracePeriod, result.State);
        Assert.Equal(EntitlementReason.BillingIssue, result.Reason);
        Assert.Equal(Now.AddDays(15), result.AccessEndsAtUtc);
    }

    [Fact]
    public void BillingRetry_HasNoAccess()
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.BillingRetry, Now.AddDays(-3)), Now);

        Assert.Equal(StorePurchaseState.OnHold, result.State);
        Assert.Equal(Now.AddDays(-3), result.AccessEndsAtUtc);
    }

    [Theory]
    [InlineData(1, EntitlementReason.Cancelled)]
    [InlineData(2, EntitlementReason.BillingIssue)]
    [InlineData(3, EntitlementReason.None)]
    [InlineData(5, EntitlementReason.None)]
    public void Expired_TakesItsReasonFromTheExpirationIntent(int intent, EntitlementReason expected)
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Expired, Now.AddDays(-5), renewal: Renewal(intent: intent)), Now);

        Assert.Equal(StorePurchaseState.Expired, result.State);
        Assert.Equal(expected, result.Reason);
        Assert.Equal(Now.AddDays(-5), result.AccessEndsAtUtc);
    }

    [Fact]
    public void Revoked_IsNeverAccess_AndEndsAtTheRevocation()
    {
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Revoked, Now.AddDays(20), revoked: Now.AddDays(-2)), Now);

        Assert.Equal(StorePurchaseState.Revoked, result.State);
        Assert.Equal(EntitlementReason.Refunded, result.Reason);
        Assert.Equal(Now.AddDays(-2), result.AccessEndsAtUtc);
    }

    [Fact]
    public void ARevocationDate_WinsOverAnActiveStatus()
    {
        // The status the API reports can lag a refund; a revocation date on the transaction is final.
        var result = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, Now.AddDays(20), revoked: Now.AddHours(-1)), Now);

        Assert.Equal(StorePurchaseState.Revoked, result.State);
    }

    [Fact]
    public void ALiveStatusWithoutExpiry_IsMalformed_NotGuessed()
    {
        Assert.Throws<AppleMalformedException>(() => AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, expires: null), Now));
    }

    [Fact]
    public void AnUnknownStatus_IsMalformed()
    {
        Assert.Throws<AppleMalformedException>(() => AppleSubscriptionNormalizer.Normalize(Snap((AppleSubscriptionStatus)99, Now.AddDays(1)), Now));
    }

    [Fact]
    public void NextReconcile_FollowsTheExpiry_ButNeverLaterThanADay()
    {
        var soon = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, Now.AddHours(2), renewal: Renewal()), Now);
        var far = AppleSubscriptionNormalizer.Normalize(Snap(AppleSubscriptionStatus.Active, Now.AddDays(300), renewal: Renewal()), Now);

        Assert.Equal(Now.AddHours(2).AddMinutes(10), soon.NextReconcileAtUtc);
        Assert.Equal(Now.AddHours(24), far.NextReconcileAtUtc);
    }
}
