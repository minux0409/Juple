using System.Text;
using Google.Apis.AndroidPublisher.v3.Data;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Juple.Infrastructure.Billing;

namespace Juple.UnitTests.Billing.GooglePlay;

public sealed class GooglePurchaseNormalizerTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Future = Now.AddDays(20);
    private static readonly DateTimeOffset Past = Now.AddDays(-3);

    [Fact]
    public void Pending_GrantsNothing_AndIsNeverAcknowledged()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Pending, expiry: null), Now);

        Assert.Equal(StorePurchaseState.Pending, result.State);
        Assert.Null(result.AccessEndsAtUtc);
        Assert.False(result.AcknowledgementPending);
        Assert.False(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
        Assert.Equal(Now + GooglePurchaseNormalizer.PendingReconcileInterval, result.NextReconcileAtUtc);
    }

    [Fact]
    public void Active_IsLiveUntilTheStoresExpiry()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Active, expiry: Future), Now);

        Assert.Equal(StorePurchaseState.Active, result.State);
        Assert.Equal(EntitlementReason.None, result.Reason);
        Assert.Equal(Future, result.AccessEndsAtUtc);
        Assert.True(result.AcknowledgementPending);
        Assert.True(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
        Assert.False(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Future));
    }

    [Fact]
    public void Canceled_StaysLiveThroughThePaidPeriod_WithReasonCancelled()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Canceled, expiry: Future, ackPending: false), Now);

        Assert.Equal(StorePurchaseState.Canceled, result.State);
        Assert.Equal(EntitlementReason.Cancelled, result.Reason);
        Assert.Equal(Future, result.AccessEndsAtUtc);
        Assert.True(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
    }

    [Fact]
    public void GracePeriod_IsLive_ButOnlyForAShortReVerifiedHorizon_NeverOpenEnded()
    {
        // The store's expiry is in the past (the renewal failed); Google does not document the grace end, so access is bounded.
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.InGracePeriod, expiry: Past), Now);

        Assert.Equal(StorePurchaseState.GracePeriod, result.State);
        Assert.Equal(EntitlementReason.BillingIssue, result.Reason);
        Assert.Equal(Now + GooglePurchaseNormalizer.GraceVerificationHorizon, result.AccessEndsAtUtc);
        Assert.True(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
        Assert.False(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now.AddDays(2)));
        Assert.True(result.NextReconcileAtUtc <= Now + GooglePurchaseNormalizer.GraceReconcileInterval);
    }

    [Fact]
    public void GracePeriod_KeepsALaterStoreExpiryWhenGoogleReportsOne()
    {
        var later = Now.AddDays(5);

        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.InGracePeriod, expiry: later), Now);

        Assert.Equal(later, result.AccessEndsAtUtc);
    }

    [Theory]
    [InlineData(GoogleSubscriptionState.OnHold, StorePurchaseState.OnHold, EntitlementReason.BillingIssue)]
    [InlineData(GoogleSubscriptionState.Paused, StorePurchaseState.Paused, EntitlementReason.Paused)]
    public void HoldAndPause_AreNotLive_AndEndAtTheExpiry(GoogleSubscriptionState google, StorePurchaseState state, EntitlementReason reason)
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(google, expiry: Past, ackPending: false), Now);

        Assert.Equal(state, result.State);
        Assert.Equal(reason, result.Reason);
        Assert.Equal(Past, result.AccessEndsAtUtc);
        Assert.False(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
    }

    [Fact]
    public void AHoldWithAFutureExpiry_NeverEndsLaterThanWhenItWasLearned()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.OnHold, expiry: Future), Now);

        Assert.Equal(Now, result.AccessEndsAtUtc);
    }

    [Theory]
    [InlineData(GoogleCancelSource.User, StorePurchaseState.Expired, EntitlementReason.Cancelled)]
    [InlineData(GoogleCancelSource.System, StorePurchaseState.Expired, EntitlementReason.BillingIssue)]
    [InlineData(GoogleCancelSource.Developer, StorePurchaseState.Revoked, EntitlementReason.Refunded)]
    [InlineData(GoogleCancelSource.Replaced, StorePurchaseState.Expired, EntitlementReason.None)]
    [InlineData(GoogleCancelSource.None, StorePurchaseState.Expired, EntitlementReason.None)]
    public void Expired_ExplainsWhoEndedIt_AndIsNeverLive(GoogleCancelSource source, StorePurchaseState state, EntitlementReason reason)
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Expired, expiry: Past, ackPending: false, cancel: source), Now);

        Assert.Equal(state, result.State);
        Assert.Equal(reason, result.Reason);
        Assert.Equal(Past, result.AccessEndsAtUtc);
        Assert.False(new PurchaseAccess(result.State, result.Reason, result.AccessEndsAtUtc).IsLiveAt(Now));
    }

    [Fact]
    public void ARevokedSubscriptionWithAFutureExpiry_EndedWhenLearned_NotAtTheFutureExpiry()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Expired, expiry: Future, ackPending: false, cancel: GoogleCancelSource.Developer), Now);

        Assert.Equal(StorePurchaseState.Revoked, result.State);
        Assert.Equal(Now, result.AccessEndsAtUtc);
    }

    [Fact]
    public void ACanceledPendingPurchase_GrantsNothing()
    {
        var result = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.PendingPurchaseCanceled, expiry: null, ackPending: false), Now);

        Assert.Equal(StorePurchaseState.Expired, result.State);
        Assert.Null(result.AccessEndsAtUtc);
    }

    [Fact]
    public void EveryGoogleStateIsHandled()
    {
        foreach (var state in Enum.GetValues<GoogleSubscriptionState>())
        {
            var snapshot = GoogleTestData.Snapshot(state, expiry: Future, ackPending: false);
            // Must not throw "unknown state": each is mapped explicitly.
            Assert.NotNull(GooglePurchaseNormalizer.Normalize(snapshot, Now));
        }
    }

    [Fact]
    public void APrepaidPlan_IsRefused_NotMisreadAsRecurring()
    {
        Assert.Throws<GooglePlayMalformedResponseException>(
            () => GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(plan: GooglePlanType.Prepaid, expiry: Future), Now));
    }

    [Theory]
    [InlineData(GoogleSubscriptionState.Active)]
    [InlineData(GoogleSubscriptionState.Canceled)]
    [InlineData(GoogleSubscriptionState.InGracePeriod)]
    public void ALiveStateWithoutAnExpiry_IsMalformed(GoogleSubscriptionState state)
    {
        Assert.Throws<GooglePlayMalformedResponseException>(() => GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(state, expiry: null), Now));
    }

    [Fact]
    public void TheReconcileCadenceIsBounded_Between5MinutesAndADay()
    {
        var soon = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Active, expiry: Now.AddMinutes(1)), Now);
        var far = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Active, expiry: Now.AddDays(25)), Now);
        var renewing = GooglePurchaseNormalizer.Normalize(GoogleTestData.Snapshot(GoogleSubscriptionState.Active, expiry: Now.AddHours(-1)), Now);

        Assert.True(soon.NextReconcileAtUtc >= Now.AddMinutes(5));
        Assert.Equal(Now + GooglePurchaseNormalizer.MaxReconcileInterval, far.NextReconcileAtUtc);
        Assert.True(renewing.NextReconcileAtUtc >= Now.AddMinutes(5) && renewing.NextReconcileAtUtc <= Now.AddMinutes(6));
    }
}

public sealed class PurchaseTokenProtectorTests
{
    private const string Token = "kdhjfkdjhfkjdshfkjsdhf.AO-J1Oabc_very_long_looking_purchase_token_0123456789";

    private static PurchaseTokenProtector Protector(string? key = null) => new(new BillingOptions { Google = new GoogleBillingOptions { PurchaseTokenEncryptionKey = key ?? GoogleTestData.Key32B } });

    [Fact]
    public void ItRoundTrips_AndTheSealedBytesDoNotContainThePlaintext()
    {
        var sealedToken = Protector().Seal(Token);

        Assert.Equal(Token, Protector().Open(sealedToken));
        Assert.False(sealedToken.AsSpan().IndexOf(Encoding.UTF8.GetBytes(Token)) >= 0);
        Assert.False(sealedToken.AsSpan().IndexOf(Encoding.UTF8.GetBytes(Token[..12])) >= 0);
    }

    [Fact]
    public void EachSealUsesAFreshNonce()
    {
        var protector = Protector();

        Assert.NotEqual(protector.Seal(Token), protector.Seal(Token));
    }

    [Fact]
    public void AnyAlterationIsRejected()
    {
        var protector = Protector();
        var sealedToken = protector.Seal(Token);

        for (var index = 0; index < sealedToken.Length; index += 7)
        {
            var tampered = sealedToken.ToArray();
            tampered[index] ^= 0x01;
            Assert.Throws<PurchaseTokenTamperedException>(() => protector.Open(tampered));
        }

        Assert.Throws<PurchaseTokenTamperedException>(() => protector.Open(sealedToken[..^1]));
        Assert.Throws<PurchaseTokenTamperedException>(() => protector.Open([]));
        Assert.Throws<PurchaseTokenTamperedException>(() => protector.Open(new byte[40]));
    }

    [Fact]
    public void AnotherKeyCannotOpenIt()
    {
        var sealedToken = Protector(GoogleTestData.Key32B).Seal(Token);

        Assert.Throws<PurchaseTokenTamperedException>(() => Protector(GoogleTestData.Key32).Open(sealedToken));
    }

    [Fact]
    public void TheHashIsDeterministic_Sha256_AndDifferentPerToken()
    {
        var protector = Protector();

        Assert.Equal(protector.Hash(Token), protector.Hash(Token));
        Assert.Equal(32, protector.Hash(Token).Length);
        Assert.NotEqual(protector.Hash(Token), protector.Hash(Token + "x"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64!")]
    public void WithoutAUsableKeyItRefusesToSeal(string? key)
    {
        Assert.Throws<InvalidOperationException>(() => new PurchaseTokenProtector(new BillingOptions { Google = new GoogleBillingOptions { PurchaseTokenEncryptionKey = key } }).Seal(Token));
    }

    [Fact]
    public void TheKeyMustBeExactly32Bytes()
    {
        Assert.Throws<InvalidOperationException>(() => Protector(Convert.ToBase64String(new byte[31])).Seal(Token));
        Assert.Throws<InvalidOperationException>(() => Protector(Convert.ToBase64String(new byte[33])).Seal(Token));
    }
}

public sealed class GoogleAccountIdProviderTests
{
    private static GoogleAccountIdProvider Provider(string? key = null) => new(new BillingOptions { Google = new GoogleBillingOptions { AccountHashKey = key ?? GoogleTestData.Key32 } });

    [Fact]
    public void ItIsDeterministicPerAccount_DifferentAcrossAccounts_AndUrlSafe43Characters()
    {
        var provider = Provider();

        Assert.Equal(provider.Compute(42), provider.Compute(42));
        Assert.NotEqual(provider.Compute(42), provider.Compute(43));
        Assert.Equal(43, provider.Compute(42).Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", provider.Compute(42));
    }

    [Fact]
    public void ItNeverContainsTheUserId_AndDependsOnTheKey()
    {
        Assert.DoesNotContain("42", Provider().Compute(42), StringComparison.Ordinal);
        Assert.NotEqual(Provider(GoogleTestData.Key32).Compute(42), Provider(GoogleTestData.Key32B).Compute(42));
    }

    [Fact]
    public void WithoutAKeyItRefuses()
    {
        Assert.Throws<InvalidOperationException>(() => new GoogleAccountIdProvider(new BillingOptions()).Compute(1));
    }
}

public sealed class GoogleBillingOptionsValidatorTests
{
    [Fact]
    public void Disabled_NeedsNothing()
    {
        BillingOptionsValidator.ValidateGoogle(new BillingOptions());
        BillingOptionsValidator.ValidateGoogle(new BillingOptions { Google = new GoogleBillingOptions { Enabled = false } });
    }

    [Fact]
    public void ThePackageNameDefaultsToTheApp_AndGoogleIsOffByDefault()
    {
        var google = new BillingOptions().Google;

        Assert.False(google.Enabled);
        Assert.Equal("com.juple.app", google.PackageName);
        Assert.Null(google.ProductId);
        Assert.Null(google.BasePlanId);
    }

    [Fact]
    public void FullyConfigured_IsAccepted()
    {
        BillingOptionsValidator.ValidateGoogle(GoogleTestData.Options());
    }

    public static TheoryData<string> RequiredSettings => new()
    {
        "ProductId", "BasePlanId", "ServiceAccountCredentialJson", "AccountHashKey", "PurchaseTokenEncryptionKey", "Audience", "PushServiceAccountEmail",
    };

    [Theory]
    [MemberData(nameof(RequiredSettings))]
    public void Enabled_NamesTheMissingSetting_AndNeverEchoesASecret(string missing)
    {
        var options = GoogleTestData.Options();
        switch (missing)
        {
            case "ProductId": options.Google.ProductId = null; break;
            case "BasePlanId": options.Google.BasePlanId = " "; break;
            case "ServiceAccountCredentialJson": options.Google.ServiceAccountCredentialJson = null; break;
            case "AccountHashKey": options.Google.AccountHashKey = "short"; break;
            case "PurchaseTokenEncryptionKey": options.Google.PurchaseTokenEncryptionKey = Convert.ToBase64String(new byte[16]); break;
            case "Audience": options.Google.PubSub.Audience = null; break;
            case "PushServiceAccountEmail": options.Google.PubSub.PushServiceAccountEmail = null; break;
        }

        var exception = Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.ValidateGoogle(options));

        Assert.Contains(missing, exception.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(GoogleTestData.Key32, exception.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(GoogleTestData.Key32B, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void TheThreeSecretsMustBeDistinct()
    {
        var sameAsTrial = GoogleTestData.Options();
        sameAsTrial.TrialIdentityHashKey = sameAsTrial.Google.AccountHashKey;
        var sameGoogle = GoogleTestData.Options();
        sameGoogle.Google.PurchaseTokenEncryptionKey = sameGoogle.Google.AccountHashKey;

        Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.ValidateGoogle(sameAsTrial));
        Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.ValidateGoogle(sameGoogle));
    }
}

public sealed class EntitlementCalculatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly TrialWindow LiveTrial = new(Now.AddDays(-5), Now.AddDays(25));
    private static readonly TrialWindow EndedTrial = new(Now.AddDays(-60), Now.AddDays(-30));

    private static PurchaseAccess Purchase(StorePurchaseState state, DateTimeOffset? end, EntitlementReason reason = EntitlementReason.None) => new(state, reason, end);

    [Fact]
    public void TrialOnly()
    {
        Assert.Equal(EntitlementStatus.Trial, EntitlementCalculator.Effective(LiveTrial, [], Now).Status);
        Assert.Equal(EntitlementStatus.Expired, EntitlementCalculator.Effective(EndedTrial, [], Now).Status);
    }

    [Fact]
    public void AnActiveGooglePurchase_WinsOverAnExpiredTrial_AndOverALiveOne()
    {
        var active = Purchase(StorePurchaseState.Active, Now.AddDays(10));

        var overExpired = EntitlementCalculator.Effective(EndedTrial, [active], Now);
        var overLive = EntitlementCalculator.Effective(LiveTrial, [active], Now);

        Assert.Equal(EntitlementStatus.Active, overExpired.Status);
        Assert.True(overExpired.CanWrite);
        Assert.Null(overExpired.AccessFrozenAtUtc);
        Assert.Equal(Now.AddDays(10), overExpired.CurrentPeriodEndsAtUtc);
        Assert.Equal(EntitlementStatus.Active, overLive.Status);
    }

    [Fact]
    public void GracePeriod_IsLive()
    {
        var result = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.GracePeriod, Now.AddHours(20), EntitlementReason.BillingIssue)], Now);

        Assert.Equal(EntitlementStatus.GracePeriod, result.Status);
        Assert.Equal(EntitlementReason.BillingIssue, result.Reason);
        Assert.True(result.CanWrite);
    }

    [Fact]
    public void CanceledButStillPaid_IsActiveWithReasonCancelled()
    {
        var result = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.Canceled, Now.AddDays(4), EntitlementReason.Cancelled)], Now);

        Assert.Equal(EntitlementStatus.Active, result.Status);
        Assert.Equal(EntitlementReason.Cancelled, result.Reason);
        Assert.True(result.CanWrite);
    }

    [Fact]
    public void OnHold_IsExpired_FrozenAtTheEnd_WithBillingIssue()
    {
        var end = Now.AddDays(-2);

        var result = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.OnHold, end, EntitlementReason.BillingIssue)], Now);

        Assert.Equal(EntitlementStatus.Expired, result.Status);
        Assert.False(result.CanWrite);
        Assert.Equal(end, result.AccessFrozenAtUtc);
        Assert.Equal(EntitlementReason.BillingIssue, result.Reason);
    }

    [Fact]
    public void Revoked_IsExpiredWithReasonRefunded_AndPausedWithReasonPaused()
    {
        var revoked = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.Revoked, Now.AddDays(-1), EntitlementReason.Refunded)], Now);
        var paused = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.Paused, Now.AddDays(-1), EntitlementReason.Paused)], Now);

        Assert.Equal(EntitlementReason.Refunded, revoked.Reason);
        Assert.Equal(EntitlementReason.Paused, paused.Reason);
        Assert.All(new[] { revoked, paused }, entitlement => Assert.False(entitlement.CanWrite));
    }

    [Fact]
    public void ThePendingPurchase_GrantsNothing_AndDoesNotMoveTheFreezeInstant()
    {
        var result = EntitlementCalculator.Effective(EndedTrial, [Purchase(StorePurchaseState.Pending, null)], Now);

        Assert.Equal(EntitlementStatus.Expired, result.Status);
        Assert.Equal(EndedTrial.EndsAtUtc, result.AccessFrozenAtUtc);
    }

    [Fact]
    public void ManyPurchases_TheBestLiveOneWins_FullyPaidBeatsGrace()
    {
        var result = EntitlementCalculator.Effective(
            EndedTrial,
            [
                Purchase(StorePurchaseState.Expired, Now.AddDays(-9)),
                Purchase(StorePurchaseState.GracePeriod, Now.AddHours(30), EntitlementReason.BillingIssue),
                Purchase(StorePurchaseState.Active, Now.AddDays(3)),
            ],
            Now);

        Assert.Equal(EntitlementStatus.Active, result.Status);
        Assert.Equal(Now.AddDays(3), result.CurrentPeriodEndsAtUtc);
    }

    [Fact]
    public void WhenNothingIsLive_TheFreezeInstantIsTheLatestEndAcrossEverything_AndIsStable()
    {
        var purchases = new[]
        {
            Purchase(StorePurchaseState.Expired, Now.AddDays(-9), EntitlementReason.Cancelled),
            Purchase(StorePurchaseState.OnHold, Now.AddDays(-4), EntitlementReason.BillingIssue),
        };

        var early = EntitlementCalculator.Effective(EndedTrial, purchases, Now);
        var late = EntitlementCalculator.Effective(EndedTrial, purchases, Now.AddDays(200));

        Assert.Equal(Now.AddDays(-4), early.AccessFrozenAtUtc);
        Assert.Equal(early.AccessFrozenAtUtc, late.AccessFrozenAtUtc);
        Assert.Equal(EntitlementReason.BillingIssue, early.Reason);
    }

    [Fact]
    public void AfterTheSubscriptionEnds_AndTheTrialEndedLater_TheTrialEndIsTheFreeze()
    {
        var trialEndedLater = new TrialWindow(Now.AddDays(-100), Now.AddDays(-1));

        var result = EntitlementCalculator.Effective(trialEndedLater, [Purchase(StorePurchaseState.Expired, Now.AddDays(-50), EntitlementReason.Cancelled)], Now);

        Assert.Equal(trialEndedLater.EndsAtUtc, result.AccessFrozenAtUtc);
        Assert.Equal(EntitlementReason.None, result.Reason);
    }

    [Fact]
    public void ResubscribingMakesItActiveAgain_WithNoFreezeBoundary()
    {
        var expired = Purchase(StorePurchaseState.Expired, Now.AddDays(-9));
        var resubscribed = Purchase(StorePurchaseState.Active, Now.AddDays(30));

        Assert.NotNull(EntitlementCalculator.Effective(EndedTrial, [expired], Now).AccessFrozenAtUtc);
        Assert.Null(EntitlementCalculator.Effective(EndedTrial, [expired, resubscribed], Now).AccessFrozenAtUtc);
    }

    [Fact]
    public void AnExpiredGooglePurchase_NeverUsesTheDeviceClock_OnlyTheServersNow()
    {
        var purchase = Purchase(StorePurchaseState.Active, Now.AddMinutes(1));

        Assert.Equal(EntitlementStatus.Active, EntitlementCalculator.Effective(EndedTrial, [purchase], Now).Status);
        Assert.Equal(EntitlementStatus.Expired, EntitlementCalculator.Effective(EndedTrial, [purchase], Now.AddMinutes(1)).Status);
    }
}

public sealed class GoogleSubscriptionMapperTests
{
    private static SubscriptionPurchaseV2 Response(string state, string productId = GoogleTestData.ProductId, bool prepaid = false) => new()
    {
        SubscriptionState = state,
        AcknowledgementState = "ACKNOWLEDGEMENT_STATE_PENDING",
        ExternalAccountIdentifiers = new ExternalAccountIdentifiers { ObfuscatedExternalAccountId = "acct-key" },
        LinkedPurchaseToken = "older-token",
        LineItems =
        [
            new SubscriptionPurchaseLineItem
            {
                ProductId = productId,
                ExpiryTimeDateTimeOffset = new DateTimeOffset(2027, 1, 5, 9, 0, 0, TimeSpan.FromHours(9)),
                OfferDetails = new OfferDetails { BasePlanId = "monthly" },
                AutoRenewingPlan = prepaid ? null : new AutoRenewingPlan { AutoRenewEnabled = true },
                PrepaidPlan = prepaid ? new PrepaidPlan() : null,
            },
        ],
    };

    [Theory]
    [InlineData("SUBSCRIPTION_STATE_PENDING", GoogleSubscriptionState.Pending)]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", GoogleSubscriptionState.Active)]
    [InlineData("SUBSCRIPTION_STATE_PAUSED", GoogleSubscriptionState.Paused)]
    [InlineData("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", GoogleSubscriptionState.InGracePeriod)]
    [InlineData("SUBSCRIPTION_STATE_ON_HOLD", GoogleSubscriptionState.OnHold)]
    [InlineData("SUBSCRIPTION_STATE_CANCELED", GoogleSubscriptionState.Canceled)]
    [InlineData("SUBSCRIPTION_STATE_EXPIRED", GoogleSubscriptionState.Expired)]
    [InlineData("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED", GoogleSubscriptionState.PendingPurchaseCanceled)]
    public void EveryDocumentedStateIsMapped(string wire, GoogleSubscriptionState expected)
    {
        Assert.Equal(expected, GoogleSubscriptionMapper.Map(Response(wire), GoogleTestData.ProductId).State);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("SUBSCRIPTION_STATE_UNSPECIFIED")]
    [InlineData("SOMETHING_NEW")]
    public void AnUnknownOrMissingStateIsMalformed_NeverGuessed(string? wire)
    {
        Assert.Throws<GooglePlayMalformedResponseException>(() => GoogleSubscriptionMapper.Map(Response(wire!), GoogleTestData.ProductId));
    }

    [Fact]
    public void ItMapsTheLineItemAndIdentifiers_WithTimesInUtc()
    {
        var snapshot = GoogleSubscriptionMapper.Map(Response("SUBSCRIPTION_STATE_ACTIVE"), GoogleTestData.ProductId);

        Assert.Equal(GoogleTestData.ProductId, snapshot.ProductId);
        Assert.Equal("monthly", snapshot.BasePlanId);
        Assert.Equal(GooglePlanType.AutoRenewing, snapshot.PlanType);
        Assert.True(snapshot.AutoRenewing);
        Assert.True(snapshot.AcknowledgementPending);
        Assert.Equal("acct-key", snapshot.ObfuscatedAccountId);
        Assert.Equal("older-token", snapshot.LinkedPurchaseToken);
        Assert.Equal(new DateTimeOffset(2027, 1, 5, 0, 0, 0, TimeSpan.Zero), snapshot.ExpiryTimeUtc);
        Assert.Equal(TimeSpan.Zero, snapshot.ExpiryTimeUtc!.Value.Offset);
    }

    [Fact]
    public void AnAcknowledgedPurchase_IsNotPending()
    {
        var response = Response("SUBSCRIPTION_STATE_ACTIVE");
        response.AcknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";

        Assert.False(GoogleSubscriptionMapper.Map(response, GoogleTestData.ProductId).AcknowledgementPending);
    }

    [Fact]
    public void ThePrepaidPlanIsReportedAsPrepaid_ForTheServiceToRefuse()
    {
        Assert.Equal(GooglePlanType.Prepaid, GoogleSubscriptionMapper.Map(Response("SUBSCRIPTION_STATE_ACTIVE", prepaid: true), GoogleTestData.ProductId).PlanType);
    }

    [Fact]
    public void TheAllowlistedLineItemIsChosenAmongSeveral_AndAnotherProductIsStillReportedForRefusal()
    {
        var response = Response("SUBSCRIPTION_STATE_ACTIVE", productId: "something_else");
        response.LineItems.Add(new SubscriptionPurchaseLineItem
        {
            ProductId = GoogleTestData.ProductId,
            ExpiryTimeDateTimeOffset = DateTimeOffset.UnixEpoch,
            AutoRenewingPlan = new AutoRenewingPlan { AutoRenewEnabled = true },
        });

        Assert.Equal(GoogleTestData.ProductId, GoogleSubscriptionMapper.Map(response, GoogleTestData.ProductId).ProductId);
        Assert.Equal("something_else", GoogleSubscriptionMapper.Map(Response("SUBSCRIPTION_STATE_ACTIVE", productId: "something_else"), GoogleTestData.ProductId).ProductId);
    }

    [Fact]
    public void NoLineItems_OrAnIncompleteOne_IsMalformed()
    {
        Assert.Throws<GooglePlayMalformedResponseException>(
            () => GoogleSubscriptionMapper.Map(new SubscriptionPurchaseV2 { SubscriptionState = "SUBSCRIPTION_STATE_ACTIVE", LineItems = [] }, GoogleTestData.ProductId));
        Assert.Throws<GooglePlayMalformedResponseException>(
            () => GoogleSubscriptionMapper.Map(new SubscriptionPurchaseV2 { SubscriptionState = "SUBSCRIPTION_STATE_ACTIVE", LineItems = [new SubscriptionPurchaseLineItem { ProductId = GoogleTestData.ProductId }] }, GoogleTestData.ProductId));
    }

    [Fact]
    public void CancelContext_SelectsTheSource()
    {
        SubscriptionPurchaseV2 With(CanceledStateContext context)
        {
            var response = Response("SUBSCRIPTION_STATE_EXPIRED");
            response.CanceledStateContext = context;
            return response;
        }

        Assert.Equal(GoogleCancelSource.User, GoogleSubscriptionMapper.Map(With(new CanceledStateContext { UserInitiatedCancellation = new UserInitiatedCancellation() }), GoogleTestData.ProductId).CancelSource);
        Assert.Equal(GoogleCancelSource.System, GoogleSubscriptionMapper.Map(With(new CanceledStateContext { SystemInitiatedCancellation = new SystemInitiatedCancellation() }), GoogleTestData.ProductId).CancelSource);
        Assert.Equal(GoogleCancelSource.Developer, GoogleSubscriptionMapper.Map(With(new CanceledStateContext { DeveloperInitiatedCancellation = new DeveloperInitiatedCancellation() }), GoogleTestData.ProductId).CancelSource);
        Assert.Equal(GoogleCancelSource.Replaced, GoogleSubscriptionMapper.Map(With(new CanceledStateContext { ReplacementCancellation = new ReplacementCancellation() }), GoogleTestData.ProductId).CancelSource);
        Assert.Equal(GoogleCancelSource.None, GoogleSubscriptionMapper.Map(Response("SUBSCRIPTION_STATE_ACTIVE"), GoogleTestData.ProductId).CancelSource);
    }
}
