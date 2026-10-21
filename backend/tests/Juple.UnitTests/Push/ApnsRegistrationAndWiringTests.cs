using System.Security.Cryptography;
using Juple.Api.Push;
using Juple.Application.Push;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Domain.Push;
using Juple.Infrastructure;
using Juple.Infrastructure.Push;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Juple.UnitTests.Push;

/// <summary>iOS registration rules (token format, APNs environment), Android backward compatibility, and the APNs transport wiring.</summary>
public sealed class ApnsRegistrationAndWiringTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
    private const string ApnsToken = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";

    // ---------- registration rules ----------

    [Fact]
    public async Task AnIosToken_IsStoredLowercase_WithTheProductionGatewayByDefault()
    {
        var store = new CapturingStore();
        await Service(store).RegisterAsync(1, new RegisterPushDeviceCommand(PushPlatform.Ios, "ios-1", ApnsToken, "ko"));

        Assert.Equal(ApnsToken.ToLowerInvariant(), store.Token);
        Assert.Equal(ApnsEnvironment.Production, store.Environment);
    }

    [Fact]
    public async Task AnXcodeBuild_RegistersADevelopmentToken()
    {
        var store = new CapturingStore();
        await Service(store).RegisterAsync(1, new RegisterPushDeviceCommand(PushPlatform.Ios, "ios-1", ApnsToken, "ko", ApnsEnvironment.Development));
        Assert.Equal(ApnsEnvironment.Development, store.Environment);
    }

    [Theory]
    [InlineData("not-hex-token-not-hex-token-not-hex-token-not-hex-token-not-hex-")]
    [InlineData("abc")]
    [InlineData("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9")] // odd length
    [InlineData("fMl3:APA91bF-an-fcm-registration-token-sent-to-the-wrong-platform-xxxxxxxxxxxx")]
    public async Task AnythingButAnApnsHexToken_IsRefusedForIos(string token)
    {
        var store = new CapturingStore();
        var refused = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(() =>
            Service(store).RegisterAsync(1, new RegisterPushDeviceCommand(PushPlatform.Ios, "ios-1", token, "ko")));
        Assert.Equal("pushToken", refused.Field);
        Assert.False(store.Called);
    }

    [Fact]
    public async Task AndroidRegistrations_AreUnchanged_AndRefuseAnApnsEnvironment()
    {
        var store = new CapturingStore();
        // An FCM token keeps its exact form (no hex rule, no lowercasing) - old Android clients send exactly this.
        await Service(store).RegisterAsync(1, new RegisterPushDeviceCommand(PushPlatform.Android, "android-1", "fMl3:APA91bF_Token-Mixed", "ko"));
        Assert.Equal(("fMl3:APA91bF_Token-Mixed", (ApnsEnvironment?)null), (store.Token, store.Environment));

        var refused = await Assert.ThrowsAsync<InvalidPushDeviceRegistrationException>(() =>
            Service(new CapturingStore()).RegisterAsync(1, new RegisterPushDeviceCommand(PushPlatform.Android, "android-1", "fcm", "ko", ApnsEnvironment.Production)));
        Assert.Equal("apnsEnvironment", refused.Field);
    }

    [Fact]
    public void TheDomain_GivesIosAGateway_AndNeverGivesAndroidOne()
    {
        Assert.Equal(ApnsEnvironment.Production, new PushDeviceRegistration(1, PushPlatform.Ios, "i", ApnsToken, "ko", Now, Now).ApnsEnvironment);
        Assert.Null(new PushDeviceRegistration(1, PushPlatform.Android, "a", "fcm", "ko", Now, Now).ApnsEnvironment);
        Assert.Throws<ArgumentException>(() => new PushDeviceRegistration(1, PushPlatform.Android, "a", "fcm", "ko", Now, Now, ApnsEnvironment.Development));

        var ios = new PushDeviceRegistration(1, PushPlatform.Ios, "i", ApnsToken, "ko", Now, Now, ApnsEnvironment.Development);
        ios.Reregister(ApnsToken, "en", Now, ApnsEnvironment.Production);
        Assert.Equal(ApnsEnvironment.Production, ios.ApnsEnvironment);
        ios.ReassignOwner(2, ApnsToken, "en", Now, ApnsEnvironment.Development);
        Assert.Equal((2L, ApnsEnvironment.Development), (ios.UserId, ios.ApnsEnvironment.Value));
    }

    [Theory]
    [InlineData(null, true, null)]
    [InlineData("", true, null)]
    [InlineData("production", true, ApnsEnvironment.Production)]
    [InlineData("Development", true, ApnsEnvironment.Development)]
    [InlineData("sandbox", false, null)]
    public void TheWireValue_IsTheAppsApsEnvironmentEntitlement(string? wire, bool valid, ApnsEnvironment? expected)
    {
        Assert.Equal(valid, ApnsEnvironmentWireFormat.TryParse(wire, out var parsed));
        Assert.Equal(expected, parsed);
    }

    [Fact]
    public void TheTokenHash_MatchesSqlServersHashOfTheVarcharToken()
    {
        // HASHBYTES('SHA2_256', CAST('abc' AS varchar)) = ba7816bf...
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Convert.ToHexStringLower(PushTokenHash.Of("abc")));
    }

    // ---------- wiring ----------

    [Fact]
    public void AnApnsKey_AddsTheApnsTransportForIos_NextToAnUnconfiguredAndroid()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        using var provider = Build(new Dictionary<string, string?>
        {
            ["Apns:KeyId"] = "ABC123DEFG",
            ["Apns:TeamId"] = "TEAM123456",
            ["Apns:PrivateKeyPem"] = key.ExportPkcs8PrivateKeyPem(),
        }).BuildServiceProvider();

        var router = Assert.IsType<PlatformPushSender>(provider.GetRequiredService<IPushSender>());
        Assert.IsType<ApnsPushSender>(router.IosSender);
        Assert.IsType<NotConfiguredPushSender>(router.AndroidSender);
    }

    [Fact]
    public void HalfAnApnsConfiguration_StopsStartup()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Build(new Dictionary<string, string?> { ["Apns:KeyId"] = "ABC123DEFG" }));
        Assert.Contains("Apns:", error.Message, StringComparison.Ordinal);
    }

    private static ServiceCollection Build(Dictionary<string, string?> settings)
    {
        settings["ConnectionStrings:JupleDatabase"] = "Server=unused;Database=unused";
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        return services;
    }

    private static RegisterPushDeviceService Service(CapturingStore store) => new(store, new FixedTime());

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class CapturingStore : IPushDeviceRegistrationStore
    {
        public bool Called { get; private set; }

        public string? Token { get; private set; }

        public ApnsEnvironment? Environment { get; private set; }

        public Task<PushDeviceRegistrationDto> RegisterAsync(long userId, PushPlatform platform, string installationId, string pushToken, string locale,
            DateTimeOffset nowUtc, ApnsEnvironment? apnsEnvironment = null, CancellationToken cancellationToken = default)
        {
            Called = true;
            Token = pushToken;
            Environment = apnsEnvironment;
            return Task.FromResult(new PushDeviceRegistrationDto(1, platform, installationId, locale, true, nowUtc, nowUtc, nowUtc));
        }

        public Task DisableAsync(long userId, string installationId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task DisableByIdAsync(long id, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default, string? expectedPushToken = null) => Task.CompletedTask;

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PushDeviceRegistration>>([]);

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledForUsersAsync(IReadOnlyCollection<long> userIds, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PushDeviceRegistration>>([]);
    }
}
