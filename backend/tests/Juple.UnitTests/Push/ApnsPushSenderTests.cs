using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Juple.Application.Push;
using Juple.Domain.Push;
using Juple.Infrastructure.Push;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.Push;

/// <summary>
/// APNs delivery without Apple: a throwaway P-256 key stands in for the .p8 auth key and a fake HTTP handler plays APNs. Covers the
/// provider JWT, the exact request (gateway, path, headers, body), every response class and the routing next to FCM.
/// </summary>
public sealed class ApnsPushSenderTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
    private const string IosToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    private static readonly ECDsa Key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    private static ApnsOptions Options() => new()
    {
        KeyId = "ABC123DEFG",
        TeamId = "TEAM123456",
        PrivateKeyPem = Key.ExportPkcs8PrivateKeyPem(),
    };

    private static PushDeviceRegistration Ios(ApnsEnvironment? environment = null) =>
        new(7, PushPlatform.Ios, "ios-install", IosToken, "ko", Now, Now, environment);

    private static PushDeviceRegistration Android() => new(7, PushPlatform.Android, "android-install", "fcm-token", "ko", Now, Now);

    private static PushNotificationPayload Visible(int? badge = 3) =>
        new("새 링크", "나리님이 링크를 추가했어요.", "collectionItemsAdded", 42, new Dictionary<string, string> { ["collectionId"] = "9" }, badge, Now.AddHours(6));

    private static PushNotificationPayload DataOnly() =>
        new(null, null, "collectionContentChanged", 43, new Dictionary<string, string> { ["collectionId"] = "9" }, null, Now.AddMinutes(10));

    // ---------- provider token (JWT) ----------

    [Fact]
    public void TheProviderToken_IsAnEs256JwtWithKeyIdTeamIdAndIssuedAt_ThatVerifiesWithTheKey()
    {
        var time = new MutableTime(Now);
        using var source = new ApnsProviderTokenSource(Options(), time);

        var parts = source.GetToken().Split('.');

        Assert.Equal(3, parts.Length);
        using var header = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[0]));
        Assert.Equal(("ES256", "ABC123DEFG"), (header.RootElement.GetProperty("alg").GetString(), header.RootElement.GetProperty("kid").GetString()));
        using var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1]));
        Assert.Equal("TEAM123456", claims.RootElement.GetProperty("iss").GetString());
        Assert.Equal(Now.ToUnixTimeSeconds(), claims.RootElement.GetProperty("iat").GetInt64());
        Assert.True(Key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), Base64Url.DecodeFromChars(parts[2]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Fact]
    public void TheProviderToken_IsReusedFor40Minutes_ThenResigned_AndAnInvalidatedOneIsReplaced()
    {
        var time = new MutableTime(Now);
        using var source = new ApnsProviderTokenSource(Options(), time);
        var first = source.GetToken();

        time.Now = Now.AddMinutes(39);
        Assert.Equal(first, source.GetToken());
        time.Now = Now.AddMinutes(40);
        var second = source.GetToken();
        Assert.NotEqual(first, second);

        source.Invalidate(first); // a stale rejection must not drop the newer token
        Assert.Equal(second, source.GetToken());
        time.Now = Now.AddMinutes(41);
        source.Invalidate(second);
        Assert.NotEqual(second, source.GetToken());
    }

    // ---------- the request ----------

    [Theory]
    [InlineData(null, "https://api.push.apple.com/3/device/")]
    [InlineData(ApnsEnvironment.Production, "https://api.push.apple.com/3/device/")]
    [InlineData(ApnsEnvironment.Development, "https://api.sandbox.push.apple.com/3/device/")]
    public void EachDeviceIsSentToItsOwnGateway(ApnsEnvironment? environment, string expectedPrefix)
    {
        using var request = ApnsPushSender.BuildRequest(Ios(environment), Visible(), [], "jwt", Options());
        Assert.Equal(expectedPrefix + IosToken, request.RequestUri!.ToString());
        Assert.Equal(HttpVersion.Version20, request.Version);
        Assert.Equal(HttpVersionPolicy.RequestVersionExact, request.VersionPolicy);
        Assert.Equal(HttpMethod.Post, request.Method);
    }

    [Fact]
    public void AVisiblePush_IsAnAlertWithPriority10_TheBundleIdTopic_TheExpiryAndACollapseIdPerNotification()
    {
        using var request = ApnsPushSender.BuildRequest(Ios(), Visible(), [], "the.jwt", Options());

        Assert.Equal("bearer the.jwt", request.Headers.Authorization!.ToString());
        Assert.Equal("com.juple.app", Header(request, "apns-topic"));
        Assert.Equal("alert", Header(request, "apns-push-type"));
        Assert.Equal("10", Header(request, "apns-priority"));
        Assert.Equal("n42", Header(request, "apns-collapse-id"));
        Assert.Equal(Now.AddHours(6).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), Header(request, "apns-expiration"));
    }

    [Fact]
    public void ADataOnlyPush_IsABackgroundPushWithPriority5()
    {
        using var request = ApnsPushSender.BuildRequest(Ios(), DataOnly(), [], "jwt", Options());
        Assert.Equal("background", Header(request, "apns-push-type"));
        Assert.Equal("5", Header(request, "apns-priority"));
    }

    [Fact]
    public void TheBody_CarriesTheAlertAndTheSameKeysAsTheAndroidDataMap()
    {
        using var body = JsonDocument.Parse(ApnsPushSender.BuildBody(Visible()));
        var aps = body.RootElement.GetProperty("aps");
        Assert.Equal("새 링크", aps.GetProperty("alert").GetProperty("title").GetString());
        Assert.Equal("나리님이 링크를 추가했어요.", aps.GetProperty("alert").GetProperty("body").GetString());
        Assert.Equal("default", aps.GetProperty("sound").GetString());
        Assert.Equal(3, aps.GetProperty("badge").GetInt32());

        // Exactly what FirebaseCloudMessagingSender puts in the Android data map: the payload data plus type and notificationId.
        var expected = new Dictionary<string, string> { ["collectionId"] = "9", ["type"] = "collectionItemsAdded", ["notificationId"] = "42" };
        var custom = body.RootElement.EnumerateObject().Where(property => property.Name != "aps").ToDictionary(property => property.Name, property => property.Value.GetString()!);
        Assert.Equal(expected.OrderBy(entry => entry.Key), custom.OrderBy(entry => entry.Key));
        Assert.Equal(("collectionItemsAdded", "42", "9"), (custom["type"], custom["notificationId"], custom["collectionId"]));
    }

    [Fact]
    public void ADataOnlyBody_HasContentAvailable_AndNoAlertOrBadge_AndNoBadgeMeansNoReset()
    {
        using var dataOnly = JsonDocument.Parse(ApnsPushSender.BuildBody(DataOnly()));
        var aps = dataOnly.RootElement.GetProperty("aps");
        Assert.Equal(1, aps.GetProperty("content-available").GetInt32());
        Assert.False(aps.TryGetProperty("alert", out _));
        Assert.False(aps.TryGetProperty("badge", out _));

        using var noBadge = JsonDocument.Parse(ApnsPushSender.BuildBody(Visible(badge: null)));
        Assert.False(noBadge.RootElement.GetProperty("aps").TryGetProperty("badge", out _));
    }

    // ---------- responses ----------

    [Fact]
    public async Task A200_IsSent_WithTheApnsId()
    {
        var apns = new FakeApns((_, _) => Respond(HttpStatusCode.OK, null, "D5E3-APNS-ID"));
        var result = await Sender(apns).SendAsync(Ios(), Visible());
        Assert.Equal((Juple.Domain.Notifications.NotificationDeliveryStatus.Sent, "D5E3-APNS-ID"), (result.Status, result.ProviderMessageId));
        Assert.Single(apns.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "BadDeviceToken", PushSendFailureCodes.BadDeviceToken, true)]
    [InlineData(HttpStatusCode.BadRequest, "DeviceTokenNotForTopic", PushSendFailureCodes.TokenNotForTopic, true)]
    [InlineData(HttpStatusCode.Gone, "Unregistered", PushSendFailureCodes.Unregistered, true)]
    [InlineData(HttpStatusCode.Gone, "ExpiredToken", PushSendFailureCodes.Unregistered, true)]
    [InlineData(HttpStatusCode.BadRequest, "BadCollapseId", PushSendFailureCodes.InvalidArgument, false)]
    [InlineData(HttpStatusCode.BadRequest, "TopicDisallowed", PushSendFailureCodes.InvalidArgument, false)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, "PayloadTooLarge", PushSendFailureCodes.InvalidArgument, false)]
    [InlineData(HttpStatusCode.Forbidden, "BadCertificate", PushSendFailureCodes.ThirdPartyAuthError, false)]
    [InlineData(HttpStatusCode.TooManyRequests, "TooManyRequests", PushSendFailureCodes.QuotaExceeded, false)]
    [InlineData(HttpStatusCode.TooManyRequests, "TooManyProviderTokenUpdates", PushSendFailureCodes.QuotaExceeded, false)]
    [InlineData(HttpStatusCode.InternalServerError, "InternalServerError", PushSendFailureCodes.Internal, false)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "ServiceUnavailable", PushSendFailureCodes.Unavailable, false)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "Shutdown", PushSendFailureCodes.Unavailable, false)]
    [InlineData(HttpStatusCode.BadGateway, null, PushSendFailureCodes.Unavailable, false)]
    public async Task EachApnsError_IsClassified_AndOnlyDeadTokensArePermanent(HttpStatusCode status, string? reason, string expectedCode, bool permanent)
    {
        var apns = new FakeApns((_, _) => Respond(status, reason));
        var result = await Sender(apns).SendAsync(Ios(), Visible());

        Assert.Equal((Juple.Domain.Notifications.NotificationDeliveryStatus.Failed, expectedCode), (result.Status, result.FailureCode));
        Assert.Equal(permanent, PushSendFailureCodes.IsPermanent(result.FailureCode));
        Assert.Single(apns.Requests);
    }

    [Fact]
    public async Task AnExpiredProviderToken_IsResignedAndRetriedOnce()
    {
        var time = new MutableTime(Now);
        var apns = new FakeApns((index, _) => index == 0 ? Respond(HttpStatusCode.Forbidden, "ExpiredProviderToken") : Respond(HttpStatusCode.OK, null, "retried"));
        var tokens = new ApnsProviderTokenSource(Options(), time);

        var result = await Sender(apns, tokens).SendAsync(Ios(), Visible());

        Assert.Equal("retried", result.ProviderMessageId);
        Assert.Equal(2, apns.Requests.Count);
        Assert.NotEqual(apns.Requests[0].Authorization, apns.Requests[1].Authorization);
        Assert.False(tokens.IsAuthenticationBlocked(ApnsEnvironment.Production));
    }

    [Theory]
    [InlineData("InvalidProviderToken")]
    [InlineData("MissingProviderToken")]
    [InlineData("UnrelatedKeyIdInToken")]
    [InlineData("BadEnvironmentKeyInToken")]
    [InlineData("Forbidden")]
    public async Task ARefusedCredential_IsNotRetried_NeverDisablesTheDevice_AndBlocksThatGatewayWithoutCallingApple(string reason)
    {
        var time = new MutableTime(Now);
        var apns = new FakeApns((_, _) => Respond(HttpStatusCode.Forbidden, reason));
        var tokens = new ApnsProviderTokenSource(Options(), time);
        var sender = Sender(apns, tokens);
        var firstJwt = tokens.GetToken();

        var first = await sender.SendAsync(Ios(), Visible());

        Assert.Equal(PushSendFailureCodes.ThirdPartyAuthError, first.FailureCode);
        Assert.False(PushSendFailureCodes.IsPermanent(first.FailureCode));
        Assert.Single(apns.Requests);
        Assert.Equal(firstJwt, tokens.GetToken()); // no re-signing storm (Apple throttles token refreshes)

        // Every further send to that gateway during the cooldown fails at once, with no request to Apple.
        for (var attempt = 0; attempt < 50; attempt++)
        {
            Assert.Equal(PushSendFailureCodes.ThirdPartyAuthError, (await sender.SendAsync(Ios(), Visible())).FailureCode);
        }

        Assert.Single(apns.Requests);

        // After the cooldown one request probes again.
        time.Now = Now + ApnsProviderTokenSource.AuthenticationCooldown;
        await sender.SendAsync(Ios(), Visible());
        Assert.Equal(2, apns.Requests.Count);
    }

    [Fact]
    public async Task AnExpiredTokenThatAFreshTokenDoesNotCure_BlocksTheGatewayToo()
    {
        var apns = new FakeApns((_, _) => Respond(HttpStatusCode.Forbidden, "ExpiredProviderToken"));
        var tokens = new ApnsProviderTokenSource(Options(), new MutableTime(Now));
        var sender = Sender(apns, tokens);

        Assert.Equal(PushSendFailureCodes.ThirdPartyAuthError, (await sender.SendAsync(Ios(), Visible())).FailureCode);
        Assert.Equal(2, apns.Requests.Count);
        Assert.True(tokens.IsAuthenticationBlocked(ApnsEnvironment.Production));
        await sender.SendAsync(Ios(), Visible());
        Assert.Equal(2, apns.Requests.Count);
    }

    [Fact]
    public async Task ABlockedGateway_DoesNotStopTheOtherGateway()
    {
        var apns = new FakeApns((_, _) => Respond(HttpStatusCode.OK, null, "ok"));
        var tokens = new ApnsProviderTokenSource(Options(), new MutableTime(Now));
        tokens.BlockAuthentication(ApnsEnvironment.Development);
        var sender = Sender(apns, tokens);

        Assert.Equal(PushSendFailureCodes.ThirdPartyAuthError, (await sender.SendAsync(Ios(ApnsEnvironment.Development), Visible())).FailureCode);
        Assert.Equal("ok", (await sender.SendAsync(Ios(ApnsEnvironment.Production), Visible())).ProviderMessageId);
        Assert.Single(apns.Requests);
    }

    [Fact]
    public async Task AnUnreachableGateway_IsTransient_AndAHungOneTimesOut()
    {
        var down = new FakeApns((Func<int, CancellationToken, HttpResponseMessage>)((_, _) => throw new HttpRequestException("connection refused")));
        Assert.Equal(PushSendFailureCodes.Unavailable, (await Sender(down).SendAsync(Ios(), Visible())).FailureCode);

        var options = Options();
        options.SendTimeoutSeconds = 1;
        var hung = new FakeApns(async (_, token) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), token);
            return Respond(HttpStatusCode.OK, null);
        });
        Assert.Equal(PushSendFailureCodes.SendTimeout, (await Sender(hung, options: options).SendAsync(Ios(), Visible())).FailureCode);
    }

    [Fact]
    public async Task TheSenderRefusesAnAndroidRegistration()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Sender(new FakeApns((_, _) => Respond(HttpStatusCode.OK, null))).SendAsync(Android(), Visible()));
    }

    // ---------- routing next to FCM ----------

    [Fact]
    public async Task AndroidGoesToFcmAndIosToApns_AndAnApnsCrashIsOnlyThatDevicesFailedAttempt()
    {
        var android = new RecordingSender(PushSendResult.Sent("fcm-id"));
        var ios = new RecordingSender(PushSendResult.Sent("apns-id"));
        var router = new PlatformPushSender(android, ios, NullLogger<PlatformPushSender>.Instance);

        Assert.Equal("fcm-id", (await router.SendAsync(Android(), Visible())).ProviderMessageId);
        Assert.Equal("apns-id", (await router.SendAsync(Ios(), Visible())).ProviderMessageId);
        Assert.Equal((1, 1), (android.Calls, ios.Calls));

        var crashing = new PlatformPushSender(android, new ThrowingSender(), NullLogger<PlatformPushSender>.Instance);
        Assert.Equal(PushSendFailureCodes.UnknownError, (await crashing.SendAsync(Ios(), Visible())).FailureCode);
        Assert.Equal("fcm-id", (await crashing.SendAsync(Android(), Visible())).ProviderMessageId);

        var notConfigured = new PlatformPushSender(android, new NotConfiguredPushSender(), NullLogger<PlatformPushSender>.Instance);
        Assert.Equal(PushSendFailureCodes.TransportNotConfigured, (await notConfigured.SendAsync(Ios(), Visible())).FailureCode);
    }

    // ---------- configuration ----------

    [Fact]
    public void NoConfiguration_IsNotConfigured_AndValid()
    {
        var none = new ApnsOptions();
        Assert.False(none.IsConfigured);
        Assert.Null(none.Validate());
        Assert.Null(Options().Validate());
        Assert.Equal("com.juple.app", none.BundleId);
    }

    [Fact]
    public void HalfAConfiguration_IsRefused_NamingTheSetting_WithoutEchoingTheKey()
    {
        Assert.Contains("Apns:KeyId", new ApnsOptions { TeamId = "TEAM123456", PrivateKeyPem = Key.ExportPkcs8PrivateKeyPem() }.Validate(), StringComparison.Ordinal);
        Assert.Contains("Apns:TeamId", new ApnsOptions { KeyId = "ABC123DEFG", PrivateKeyPem = Key.ExportPkcs8PrivateKeyPem() }.Validate(), StringComparison.Ordinal);
        Assert.Contains("Apns:PrivateKeyPem", new ApnsOptions { KeyId = "ABC123DEFG", TeamId = "TEAM123456" }.Validate(), StringComparison.Ordinal);
        var garbage = new ApnsOptions { KeyId = "ABC123DEFG", TeamId = "TEAM123456", PrivateKeyPem = "not a key" }.Validate();
        Assert.Contains("Apns:PrivateKeyPem", garbage, StringComparison.Ordinal);
        Assert.DoesNotContain("not a key", garbage, StringComparison.Ordinal);
        using var p384 = ECDsa.Create(ECCurve.NamedCurves.nistP384);
        Assert.Contains("P-256", new ApnsOptions { KeyId = "ABC123DEFG", TeamId = "TEAM123456", PrivateKeyPem = p384.ExportPkcs8PrivateKeyPem() }.Validate(), StringComparison.Ordinal);
        Assert.Contains("ProductionEndpoint", Options().WithEndpoint("http://api.push.apple.com").Validate(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheKey_MayBeGivenAsPemWithEscapedNewlines_OrAsTheBareBase64Body()
    {
        var pem = Key.ExportPkcs8PrivateKeyPem();
        var escaped = pem.Replace("\n", "\\n", StringComparison.Ordinal);
        var bare = Convert.ToBase64String(Key.ExportPkcs8PrivateKey());
        foreach (var form in new[] { pem, escaped, bare })
        {
            Assert.Null(new ApnsOptions { KeyId = "ABC123DEFG", TeamId = "TEAM123456", PrivateKeyPem = form }.Validate());
        }
    }

    // ---------- helpers ----------

    private static ApnsPushSender Sender(FakeApns apns, ApnsProviderTokenSource? tokens = null, ApnsOptions? options = null)
    {
        options ??= Options();
        return new ApnsPushSender(new SingleClientFactory(new HttpClient(apns)), tokens ?? new ApnsProviderTokenSource(options, new MutableTime(Now)), options, NullLogger<ApnsPushSender>.Instance);
    }

    private static string Header(HttpRequestMessage request, string name) => string.Join(",", request.Headers.GetValues(name));

    private static HttpResponseMessage Respond(HttpStatusCode status, string? reason, string? apnsId = null)
    {
        var response = new HttpResponseMessage(status);
        if (reason is not null)
        {
            response.Content = new StringContent($"{{\"reason\":\"{reason}\"}}", Encoding.UTF8, "application/json");
        }

        if (apnsId is not null)
        {
            response.Headers.TryAddWithoutValidation("apns-id", apnsId);
        }

        return response;
    }

    private sealed class FakeApns(Func<int, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public FakeApns(Func<int, CancellationToken, HttpResponseMessage> respond)
            : this((index, token) => Task.FromResult(respond(index, token)))
        {
        }

        public List<(string Uri, string? Authorization, string Topic)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var index = Requests.Count;
            Requests.Add((request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(), Header(request, "apns-topic")));
            return await respond(index, cancellationToken);
        }
    }

    private sealed class SingleClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name)
        {
            Assert.Equal(ApnsPushSender.HttpClientName, name);
            return client;
        }
    }

    private sealed class MutableTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class RecordingSender(PushSendResult result) : IPushSender
    {
        public int Calls { get; private set; }

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(result);
        }
    }

    private sealed class ThrowingSender : IPushSender
    {
        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("boom");
    }
}

internal static class ApnsOptionsTestExtensions
{
    public static ApnsOptions WithEndpoint(this ApnsOptions options, string production)
    {
        options.ProductionEndpoint = production;
        return options;
    }
}
