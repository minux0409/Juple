using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;

namespace Juple.UnitTests.Users.BootstrapCurrentUser;

public sealed class CurrentUserBootstrapServiceTests
{
    private static readonly ExternalIdentityPrincipal ExternalIdentity = new(
        Guid.Parse("11111111-1111-1111-1111-111111111111"),
        Guid.Parse("22222222-2222-2222-2222-222222222222"));

    [Fact]
    public async Task BootstrapAsync_WhenIdentityExists_DoesNotCreateUser()
    {
        var store = new FakeProvisioningStore { IdentityExists = true };
        var service = CreateService(store);

        await service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        Assert.Empty(store.CreatedUsers);
    }

    [Fact]
    public async Task BootstrapAsync_WhenIdentityExists_DelegatesTimeZoneSyncWithValidatedTimeZone()
    {
        var store = new FakeProvisioningStore { IdentityExists = true };
        var service = CreateService(store);

        await service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        var syncCall = Assert.Single(store.TimeZoneSyncCalls);
        Assert.Equal(ExternalIdentity, syncCall.ExternalIdentity);
        Assert.Equal("Asia/Seoul", syncCall.TimeZoneId);
    }

    [Fact]
    public async Task BootstrapAsync_WhenTimeZoneIsInvalid_NeverCallsTimeZoneSync()
    {
        var store = new FakeProvisioningStore { IdentityExists = true };
        var service = CreateService(store);

        await Assert.ThrowsAsync<InvalidCurrentUserBootstrapRequestException>(
            () => service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Invalid/TimeZone")));

        Assert.Empty(store.TimeZoneSyncCalls);
    }

    [Fact]
    public async Task BootstrapAsync_WhenIdentityIsNew_CreatesUserAndExternalIdentity()
    {
        var store = new FakeProvisioningStore();
        var service = CreateService(store);

        await service.BootstrapAsync(ExternalIdentity, new("ko-KR", "Asia/Seoul"));

        var data = Assert.Single(store.CreatedUsers);
        Assert.Equal(ExternalIdentity, data.ExternalIdentity);
        Assert.Equal("ko-KR", data.PreferredLocale);
        Assert.Equal("Asia/Seoul", data.TimeZoneId);
        Assert.Null(data.DefaultCurrencyCode);
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

    private static CurrentUserBootstrapService CreateService(FakeProvisioningStore store) =>
        new(store, new FixedTimeProvider());

    private sealed record TimeZoneSyncCall(ExternalIdentityPrincipal ExternalIdentity, string TimeZoneId);

    private sealed class FakeProvisioningStore : ICurrentUserProvisioningStore
    {
        public bool IdentityExists { get; init; }

        public List<CurrentUserBootstrapData> CreatedUsers { get; } = [];

        public List<TimeZoneSyncCall> TimeZoneSyncCalls { get; } = [];

        public Task<bool> ExternalIdentityExistsAsync(
            ExternalIdentityPrincipal externalIdentity,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(IdentityExists);

        public Task CreateOrGetAsync(
            CurrentUserBootstrapData data,
            CancellationToken cancellationToken = default)
        {
            CreatedUsers.Add(data);
            return Task.CompletedTask;
        }

        public Task<bool> TrySyncTimeZoneIfExistingAsync(
            ExternalIdentityPrincipal externalIdentity,
            string timeZoneId,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            if (!IdentityExists)
            {
                return Task.FromResult(false);
            }

            TimeZoneSyncCalls.Add(new TimeZoneSyncCall(externalIdentity, timeZoneId));
            return Task.FromResult(true);
        }
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            new(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);
    }
}