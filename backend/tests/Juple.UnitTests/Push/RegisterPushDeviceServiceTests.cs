using Juple.Application.Push;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Domain.Push;

namespace Juple.UnitTests.Push;

public sealed class RegisterPushDeviceServiceTests
{
    private static readonly DateTimeOffset FixedNow = new(2026, 9, 6, 10, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RegisterAsync_WhenInstallationIdIsMissingOrWhitespaceOnly_ThrowsInvalidPushDeviceRegistration(
        string? installationId)
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(
            () => service.RegisterAsync(1, Command(installationId: installationId)));

        Assert.Equal("installationId", exception.Field);
        Assert.False(store.WasRegisterCalled);
    }

    [Fact]
    public async Task RegisterAsync_WhenInstallationIdExceeds100Characters_ThrowsInvalidPushDeviceRegistration()
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(
            () => service.RegisterAsync(1, Command(installationId: new string('a', 101))));

        Assert.Equal("installationId", exception.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RegisterAsync_WhenPushTokenIsMissingOrWhitespaceOnly_ThrowsInvalidPushDeviceRegistration(
        string? pushToken)
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(
            () => service.RegisterAsync(1, Command(pushToken: pushToken)));

        Assert.Equal("pushToken", exception.Field);
        Assert.False(store.WasRegisterCalled);
    }

    [Fact]
    public async Task RegisterAsync_WhenPushTokenExceeds1024Characters_ThrowsInvalidPushDeviceRegistration()
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(
            () => service.RegisterAsync(1, Command(pushToken: new string('a', 1025))));

        Assert.Equal("pushToken", exception.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task RegisterAsync_WhenLocaleIsMissing_FallsBackToEnglishRatherThanFailing(string? locale)
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        await service.RegisterAsync(1, Command(locale: locale));

        Assert.Equal("en", store.LastLocale);
    }

    [Fact]
    public async Task RegisterAsync_WhenLocaleExceeds35Characters_FallsBackToEnglishRatherThanFailing()
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        await service.RegisterAsync(1, Command(locale: new string('a', 36)));

        Assert.Equal("en", store.LastLocale);
    }

    [Fact]
    public async Task RegisterAsync_TrimsInstallationIdAndPushToken()
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        await service.RegisterAsync(1, Command(installationId: "  install-1  ", pushToken: "  token-1  "));

        Assert.Equal("install-1", store.LastInstallationId);
        Assert.Equal("token-1", store.LastPushToken);
    }

    [Fact]
    public async Task RegisterAsync_WithValidCommand_PassesUserIdAndPlatformThroughToStore()
    {
        var store = new FakePushDeviceRegistrationStore();
        var service = new RegisterPushDeviceService(store, new FakeTimeProvider(FixedNow));

        await service.RegisterAsync(42, Command(platform: PushPlatform.Ios));

        Assert.Equal(42, store.LastUserId);
        Assert.Equal(PushPlatform.Ios, store.LastPlatform);
        Assert.Equal(FixedNow, store.LastNowUtc);
    }

    private static RegisterPushDeviceCommand Command(
        PushPlatform platform = PushPlatform.Android,
        string? installationId = "install-1",
        string? pushToken = "token-1",
        string? locale = "en") =>
        new(platform, installationId, pushToken, locale);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakePushDeviceRegistrationStore : IPushDeviceRegistrationStore
    {
        public bool WasRegisterCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public PushPlatform LastPlatform { get; private set; }

        public string? LastInstallationId { get; private set; }

        public string? LastPushToken { get; private set; }

        public string? LastLocale { get; private set; }

        public DateTimeOffset? LastNowUtc { get; private set; }

        public Task<PushDeviceRegistrationDto> RegisterAsync(
            long userId,
            PushPlatform platform,
            string installationId,
            string pushToken,
            string locale,
            DateTimeOffset nowUtc,
            CancellationToken cancellationToken = default)
        {
            WasRegisterCalled = true;
            LastUserId = userId;
            LastPlatform = platform;
            LastInstallationId = installationId;
            LastPushToken = pushToken;
            LastLocale = locale;
            LastNowUtc = nowUtc;
            return Task.FromResult(new PushDeviceRegistrationDto(
                1, platform, installationId, locale, true, nowUtc, nowUtc, nowUtc));
        }

        public Task DisableAsync(
            long userId, string installationId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(
            long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PushDeviceRegistration>>([]);
    }
}
