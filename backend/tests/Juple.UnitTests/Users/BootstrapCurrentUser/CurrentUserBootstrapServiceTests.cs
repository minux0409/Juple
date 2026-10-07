using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Users;

namespace Juple.UnitTests.Users.BootstrapCurrentUser;

public sealed class CurrentUserBootstrapServiceTests
{
    private static readonly ExternalIdentityPrincipal ExternalIdentity = new(
        Guid.Parse("11111111-1111-1111-1111-111111111111"),
        Guid.Parse("22222222-2222-2222-2222-222222222222"));

    [Fact]
    public async Task BootstrapAsync_WhenIdentityExists_DoesNotCreateUserAndReturnsExistingPlan()
    {
        var store = new FakeProvisioningStore { ExistingPlan = UserPlan.Plus };
        var service = CreateService(store);

        var result = await service.BootstrapAsync(ExternalIdentity, new("ko-KR", " Asia/Seoul "));

        Assert.Empty(store.CreatedUsers);
        Assert.Equal(UserPlan.Plus, result.Plan);
        // The stored (validated, trimmed) zone - what the server's date filters use - comes back.
        Assert.Equal("Asia/Seoul", result.TimeZoneId);
    }

    [Fact]
    public async Task BootstrapAsync_WhenIdentityExists_DelegatesTimeZoneSyncWithValidatedTimeZone()
    {
        var store = new FakeProvisioningStore { ExistingPlan = UserPlan.Free };
        var service = CreateService(store);

        await service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        var syncCall = Assert.Single(store.TimeZoneSyncCalls);
        Assert.Equal(ExternalIdentity, syncCall.ExternalIdentity);
        Assert.Equal("Asia/Seoul", syncCall.TimeZoneId);
    }

    [Fact]
    public async Task BootstrapAsync_WhenTimeZoneIsInvalid_NeverAttemptsSyncOrCreate()
    {
        var store = new FakeProvisioningStore { ExistingPlan = UserPlan.Free };
        var service = CreateService(store);

        await Assert.ThrowsAsync<InvalidCurrentUserBootstrapRequestException>(
            () => service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Invalid/TimeZone")));

        Assert.Empty(store.TimeZoneSyncCalls);
        Assert.Empty(store.CreatedUsers);
    }

    [Fact]
    public async Task BootstrapAsync_WhenIdentityIsNew_CreatesUserAndExternalIdentityAndReturnsFree()
    {
        var store = new FakeProvisioningStore();
        var service = CreateService(store);

        var result = await service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));
        var plan = result.Plan;
        Assert.Equal("Asia/Seoul", result.TimeZoneId);

        var data = Assert.Single(store.CreatedUsers);
        Assert.Equal(ExternalIdentity, data.ExternalIdentity);
        Assert.Equal("ko-KR", data.PreferredLocale);
        Assert.Equal("Asia/Seoul", data.TimeZoneId);
        Assert.Null(data.DefaultCurrencyCode);
        Assert.Equal(UserPlan.Free, plan);
    }

    [Fact]
    public async Task BootstrapAsync_WhenLocaleIsInvalid_ThrowsValidationException()
    {
        var store = new FakeProvisioningStore();
        var service = CreateService(store);

        var exception = await Assert.ThrowsAsync<InvalidCurrentUserBootstrapRequestException>(
            () => service.BootstrapAsync(ExternalIdentity, new("invalid-locale", "Asia/Seoul")));

        Assert.Equal("preferredLocale", exception.Field);
        Assert.Empty(store.CreatedUsers);
    }

    [Fact]
    public async Task BootstrapAsync_WhenTimeZoneIsInvalid_ThrowsValidationException()
    {
        var store = new FakeProvisioningStore();
        var service = CreateService(store);

        var exception = await Assert.ThrowsAsync<InvalidCurrentUserBootstrapRequestException>(
            () => service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Invalid/TimeZone")));

        Assert.Equal("timeZoneId", exception.Field);
        Assert.Empty(store.CreatedUsers);
    }

    [Fact]
    public async Task BootstrapAsync_ForAnExistingUser_CarriesTheEntitlement_AndKeepsTheLegacyPlan()
    {
        var store = new FakeProvisioningStore { ExistingPlan = UserPlan.Free };

        var result = await CreateService(store).BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        Assert.Equal(UserPlan.Free, result.Plan);
        Assert.False(result.Entitlement.ProgramEnabled);
        Assert.True(result.Entitlement.CanWrite);
        Assert.Null(result.Entitlement.Status);
    }

    [Fact]
    public async Task BootstrapAsync_ForANewUser_CarriesTheEntitlement()
    {
        var result = await CreateService(new FakeProvisioningStore()).BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        Assert.False(result.Entitlement.ProgramEnabled);
        Assert.True(result.Entitlement.CanWrite);
    }

    private static CurrentUserBootstrapService CreateService(FakeProvisioningStore store) =>
        new(store, new ProgramNotLaunchedEntitlements(), new FixedTimeProvider());

    // The subscription program is not launched in these tests: access is unrestricted and no status is claimed.
    private sealed class ProgramNotLaunchedEntitlements : Juple.Application.Billing.IEntitlementService
    {
        public Task<Juple.Domain.Billing.Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Juple.Domain.Billing.Entitlement.NotLaunched(DateTimeOffset.UnixEpoch));

        public Task<Juple.Domain.Billing.Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Juple.Domain.Billing.Entitlement.NotLaunched(DateTimeOffset.UnixEpoch));
    }

    private sealed record TimeZoneSyncCall(ExternalIdentityPrincipal ExternalIdentity, string TimeZoneId);

    private sealed class FakeProvisioningStore : ICurrentUserProvisioningStore
    {
        public UserPlan? ExistingPlan { get; init; }

        public List<CurrentUserBootstrapData> CreatedUsers { get; } = [];

        public List<TimeZoneSyncCall> TimeZoneSyncCalls { get; } = [];

        public Task<UserPlan?> TrySyncTimeZoneAndGetPlanAsync(
            ExternalIdentityPrincipal externalIdentity,
            string timeZoneId,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            if (ExistingPlan is not { } plan)
            {
                return Task.FromResult<UserPlan?>(null);
            }

            TimeZoneSyncCalls.Add(new TimeZoneSyncCall(externalIdentity, timeZoneId));
            return Task.FromResult<UserPlan?>(plan);
        }

        public Task<UserPlan> CreateAsync(
            CurrentUserBootstrapData data,
            CancellationToken cancellationToken = default)
        {
            CreatedUsers.Add(data);
            return Task.FromResult(UserPlan.Free);
        }
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            new(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);
    }
}
