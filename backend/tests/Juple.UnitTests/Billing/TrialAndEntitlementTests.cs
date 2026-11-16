using Juple.Application.Billing;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

public sealed class TrialPolicyTests
{
    private static readonly DateTimeOffset ProgramStart = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheTrialIsExactly30Times24Hours()
    {
        Assert.Equal(30, TrialPolicy.DurationDays);
        Assert.Equal(TimeSpan.FromHours(720), TrialPolicy.Duration);
        Assert.Equal(TimeSpan.FromDays(30), TrialPolicy.Duration);
    }

    [Fact]
    public void AnExistingAccount_GetsAFreshWindowFromTheProgramStart_NotFromItsCreation()
    {
        var window = TrialPolicy.WindowFor(new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero), ProgramStart);

        Assert.Equal(new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero), window.StartedAtUtc);
        Assert.Equal(new DateTimeOffset(2026, 12, 31, 0, 0, 0, TimeSpan.Zero), window.EndsAtUtc);
    }

    [Fact]
    public void ANewAccount_StartsAtItsOwnCreation()
    {
        var window = TrialPolicy.WindowFor(new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero), ProgramStart);

        Assert.Equal(new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero), window.StartedAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 1, 9, 0, 0, 0, TimeSpan.Zero), window.EndsAtUtc);
    }

    [Fact]
    public void AnAccountCreatedExactlyAtTheProgramStart_IsNew()
    {
        var window = TrialPolicy.WindowFor(ProgramStart, ProgramStart);

        Assert.Equal(ProgramStart, window.StartedAtUtc);
        Assert.Equal(ProgramStart.AddDays(30), window.EndsAtUtc);
    }

    [Fact]
    public void InstantsAreComparedInUtc_RegardlessOfTheOffsetTheyArriveWith()
    {
        // 2026-12-01T05:00+09:00 is 2026-11-30T20:00Z - before the program start, so an existing account.
        var created = new DateTimeOffset(2026, 12, 1, 5, 0, 0, TimeSpan.FromHours(9));

        var window = TrialPolicy.WindowFor(created, ProgramStart);

        Assert.Equal(ProgramStart, window.StartedAtUtc);
        Assert.Equal(TimeSpan.Zero, window.StartedAtUtc.Offset);
        Assert.Equal(TimeSpan.Zero, window.EndsAtUtc.Offset);
    }

    [Theory]
    // "The first month" is 30 x 24 h, never a calendar month: the end of a month (31 Jan, a leap February) does not shorten or stretch it.
    [InlineData("2027-01-31T15:00:00Z", "2027-03-02T15:00:00Z")]
    [InlineData("2028-01-31T00:00:00Z", "2028-03-01T00:00:00Z")]
    [InlineData("2027-02-28T23:59:59Z", "2027-03-30T23:59:59Z")]
    [InlineData("2026-12-31T23:30:00Z", "2027-01-30T23:30:00Z")]
    public void AMonthEndSignUp_StillGetsExactly30Days(string created, string ends)
    {
        var window = TrialPolicy.WindowFor(DateTimeOffset.Parse(created), ProgramStart);

        Assert.Equal(DateTimeOffset.Parse(ends), window.EndsAtUtc);
        Assert.Equal(TrialPolicy.Duration, window.EndsAtUtc - window.StartedAtUtc);
    }

    [Fact]
    public void TheEndIsOneInstant_TheSameInEveryTimeZone()
    {
        // Signing up at 00:30 in Seoul (15:30 UTC the day before) ends at 00:30 Seoul 30 days later: the zone never moves the end.
        var created = new DateTimeOffset(2026, 12, 20, 0, 30, 0, TimeSpan.FromHours(9));

        var window = TrialPolicy.WindowFor(created, ProgramStart);

        Assert.Equal(new DateTimeOffset(2027, 1, 19, 0, 30, 0, TimeSpan.FromHours(9)), window.EndsAtUtc);
    }

    private static readonly DateTimeOffset CreatedNow = new(2026, 12, 10, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ANewAccountInItsOwnFreshTrial_IsTold()
    {
        var entitlement = Entitlement.ForTrial(TrialPolicy.WindowFor(CreatedNow, ProgramStart), CreatedNow);

        Assert.True(TrialPolicy.GrantedFreshTrial(true, entitlement, CreatedNow));
    }

    [Fact]
    public void AFreshWindowReadBackWithinTheTolerance_StillCounts()
    {
        var entitlement = Entitlement.ForTrial(TrialPolicy.WindowFor(CreatedNow.AddMilliseconds(400), ProgramStart), CreatedNow.AddSeconds(1));

        Assert.True(TrialPolicy.GrantedFreshTrial(true, entitlement, CreatedNow));
    }

    [Fact]
    public void AnAccountThatWasNotCreatedByThisRequest_IsNeverTold()
    {
        var entitlement = Entitlement.ForTrial(TrialPolicy.WindowFor(CreatedNow, ProgramStart), CreatedNow);

        Assert.False(TrialPolicy.GrantedFreshTrial(false, entitlement, CreatedNow));
    }

    [Fact]
    public void WhileTheProgramIsOff_NobodyIsToldAboutAFreeMonth()
    {
        Assert.False(TrialPolicy.GrantedFreshTrial(true, Entitlement.NotLaunched(CreatedNow), CreatedNow));
    }

    [Fact]
    public void AReCreatedAccountGivenBackItsEarlierWindow_IsNotTold()
    {
        // Deleted and signed up again: the trial ledger returns the ORIGINAL window, which started long before this creation.
        var original = TrialPolicy.WindowFor(CreatedNow.AddDays(-12), ProgramStart);
        var entitlement = Entitlement.ForTrial(original, CreatedNow);

        Assert.Equal(EntitlementStatus.Trial, entitlement.Status);
        Assert.False(TrialPolicy.GrantedFreshTrial(true, entitlement, CreatedNow));
    }

    [Fact]
    public void AReCreatedAccountWhoseEarlierWindowAlreadyEnded_IsNotTold()
    {
        var original = new TrialWindow(CreatedNow.AddDays(-40), CreatedNow.AddDays(-40) + TrialPolicy.Duration);
        var entitlement = Entitlement.ForTrial(original, CreatedNow);

        Assert.Equal(EntitlementStatus.Expired, entitlement.Status);
        Assert.False(TrialPolicy.GrantedFreshTrial(true, entitlement, CreatedNow));
    }

    [Fact]
    public void AnAccountCreatedBeforeTheProgramStarts_IsNotANewTrialAccount()
    {
        // Its window begins at the program start, not at its creation.
        var created = ProgramStart.AddDays(-3);
        var entitlement = Entitlement.ForTrial(TrialPolicy.WindowFor(created, ProgramStart), ProgramStart.AddHours(1));

        Assert.False(TrialPolicy.GrantedFreshTrial(true, entitlement, created));
    }
}

public sealed class EntitlementTests
{
    private static readonly TrialWindow Window = new(
        new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2026, 12, 31, 0, 0, 0, TimeSpan.Zero));

    [Fact]
    public void NotLaunched_RestrictsNobody_AndClaimsNoStatus()
    {
        var now = new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);

        var entitlement = Entitlement.NotLaunched(now);

        Assert.False(entitlement.ProgramEnabled);
        Assert.Null(entitlement.Status);
        Assert.Null(entitlement.Reason);
        Assert.True(entitlement.CanWrite);
        Assert.Null(entitlement.AccessFrozenAtUtc);
        Assert.Null(entitlement.TrialEndsAtUtc);
        Assert.Equal(now, entitlement.VerifiedAtUtc);
    }

    [Fact]
    public void BeforeTheTrialEnds_IsTrial_AndCanWrite()
    {
        var now = Window.EndsAtUtc.AddTicks(-1);

        var entitlement = Entitlement.ForTrial(Window, now);

        Assert.True(entitlement.ProgramEnabled);
        Assert.Equal(EntitlementStatus.Trial, entitlement.Status);
        Assert.Equal(EntitlementReason.None, entitlement.Reason);
        Assert.True(entitlement.CanWrite);
        Assert.Null(entitlement.AccessFrozenAtUtc);
        Assert.Equal(Window.StartedAtUtc, entitlement.TrialStartedAtUtc);
        Assert.Equal(Window.EndsAtUtc, entitlement.TrialEndsAtUtc);
        Assert.Equal(now, entitlement.VerifiedAtUtc);
    }

    [Fact]
    public void TheExactEndInstant_IsAlreadyExpired()
    {
        var entitlement = Entitlement.ForTrial(Window, Window.EndsAtUtc);

        Assert.Equal(EntitlementStatus.Expired, entitlement.Status);
        Assert.False(entitlement.CanWrite);
    }

    [Fact]
    public void AfterTheTrial_IsExpired_AndTheFreezeInstantIsTheTrialEnd_NotNow()
    {
        var early = Entitlement.ForTrial(Window, Window.EndsAtUtc.AddMinutes(1));
        var late = Entitlement.ForTrial(Window, Window.EndsAtUtc.AddDays(200));

        foreach (var entitlement in new[] { early, late })
        {
            Assert.Equal(EntitlementStatus.Expired, entitlement.Status);
            Assert.False(entitlement.CanWrite);
            Assert.Equal(Window.EndsAtUtc, entitlement.AccessFrozenAtUtc);
        }

        // Stable: the boundary did not move with the clock.
        Assert.Equal(early.AccessFrozenAtUtc, late.AccessFrozenAtUtc);
        Assert.NotEqual(early.VerifiedAtUtc, late.VerifiedAtUtc);
    }

    [Theory]
    [InlineData(EntitlementStatus.Active)]
    [InlineData(EntitlementStatus.GracePeriod)]
    public void APaidLiveState_CanWrite_AndHasNoFreezeBoundary(EntitlementStatus status)
    {
        var periodEnd = new DateTimeOffset(2027, 2, 1, 0, 0, 0, TimeSpan.Zero);

        var entitlement = Entitlement.Paid(status, periodEnd, status == EntitlementStatus.GracePeriod ? EntitlementReason.BillingIssue : EntitlementReason.None, Window, Window.EndsAtUtc.AddDays(5));

        Assert.Equal(status, entitlement.Status);
        Assert.True(entitlement.CanWrite);
        Assert.Null(entitlement.AccessFrozenAtUtc);
        Assert.Equal(periodEnd, entitlement.CurrentPeriodEndsAtUtc);
    }

    [Theory]
    [InlineData(EntitlementStatus.Trial)]
    [InlineData(EntitlementStatus.Expired)]
    public void Paid_RefusesAStatusThatIsNotAPaidLiveOne(EntitlementStatus status)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => Entitlement.Paid(status, DateTimeOffset.UnixEpoch, EntitlementReason.None, null, DateTimeOffset.UnixEpoch));
    }

    [Fact]
    public void ExpiredAfterAPaidPeriod_CarriesThePaidEndAsItsFreezeInstant()
    {
        var paidEnd = new DateTimeOffset(2027, 3, 1, 0, 0, 0, TimeSpan.Zero);

        var entitlement = Entitlement.Expired(Window, paidEnd, EntitlementReason.Cancelled, paidEnd.AddDays(9));

        Assert.False(entitlement.CanWrite);
        Assert.Equal(paidEnd, entitlement.AccessFrozenAtUtc);
        Assert.Equal(EntitlementReason.Cancelled, entitlement.Reason);
    }
}

public sealed class BillingOptionsValidatorTests
{
    private static readonly string ValidKey = Convert.ToBase64String(new byte[32]);

    [Fact]
    public void ADisabledProgram_NeedsNothingElse()
    {
        BillingOptionsValidator.Validate(new BillingOptions());
        BillingOptionsValidator.Validate(new BillingOptions { ProgramEnabled = false, ProgramStartAtUtc = null, TrialIdentityHashKey = null });
    }

    [Theory]
    [InlineData(0)]
    [InlineData(7)]
    [InlineData(31)]
    public void AnyTrialLengthOtherThan30_FailsEvenWhileDisabled(int days)
    {
        var exception = Assert.Throws<InvalidOperationException>(() => BillingOptionsValidator.Validate(new BillingOptions { TrialDurationDays = days }));

        Assert.Contains("Billing:TrialDurationDays", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AnEnabledProgram_NeedsAStartInstant()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => BillingOptionsValidator.Validate(new BillingOptions { ProgramEnabled = true, TrialIdentityHashKey = ValidKey }));

        Assert.Contains("Billing:ProgramStartAtUtc", exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64 !!")]
    public void AnEnabledProgram_NeedsAUsableHashKey_AndNeverEchoesIt(string? key)
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => BillingOptionsValidator.Validate(new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch, TrialIdentityHashKey = key }));

        Assert.Contains("Billing:TrialIdentityHashKey", exception.Message, StringComparison.Ordinal);
        if (!string.IsNullOrEmpty(key))
        {
            Assert.DoesNotContain(key, exception.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void AKeyShorterThan32Bytes_IsRefused()
    {
        var shortKey = Convert.ToBase64String(new byte[31]);

        Assert.Throws<InvalidOperationException>(
            () => BillingOptionsValidator.Validate(new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch, TrialIdentityHashKey = shortKey }));
    }

    [Fact]
    public void AFullyConfiguredEnabledProgram_IsAccepted()
    {
        BillingOptionsValidator.Validate(new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch, TrialIdentityHashKey = ValidKey });
    }
}
