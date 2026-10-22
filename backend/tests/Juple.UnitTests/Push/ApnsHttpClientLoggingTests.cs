using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Juple.Application.Push;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Infrastructure;
using Juple.Infrastructure.Push;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.Push;

/// <summary>Uses production DI and the real HttpClientFactory logging pipeline; only the network handler is replaced.</summary>
public sealed class ApnsHttpClientLoggingTests
{
    private const string DeviceToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    private const string SafeApnsId = "ea12b2bd-42e8-4af7-8f98-1fbacfaefc48";

    [Fact]
    public async Task UnprotectedFactory_ReproducesTheExactInformationLogCategories()
    {
        var logs = new CapturingLogs();
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.SetMinimumLevel(LogLevel.Information).AddProvider(logs));
        services.AddHttpClient(ApnsPushSender.HttpClientName)
            .ConfigurePrimaryHttpMessageHandler(() => new MockApns(_ => new HttpResponseMessage(HttpStatusCode.OK)));
        using var provider = services.BuildServiceProvider();
        using var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(ApnsPushSender.HttpClientName);
        using var response = await client.PostAsync($"https://api.sandbox.push.apple.com/3/device/{DeviceToken}", new StringContent("{}"));

        foreach (var suffix in new[] { "LogicalHandler", "ClientHandler" })
        {
            Assert.Contains(logs.Entries, entry => entry.Category == $"System.Net.Http.HttpClient.apns.{suffix}"
                && entry.Level == LogLevel.Information && entry.Text.Contains(DeviceToken, StringComparison.Ordinal));
        }
    }

    [Theory]
    [InlineData(ApnsEnvironment.Production)]
    [InlineData(ApnsEnvironment.Development)]
    public async Task ConfiguredTransport_SendsNormally_WithoutLoggingUrlTokenOrCredentials_EvenAtTrace(ApnsEnvironment environment)
    {
        using var fixture = new Fixture((_, _) => Response(HttpStatusCode.OK, null, SafeApnsId));
        var result = await fixture.SendAsync(environment);

        Assert.Equal(NotificationDeliveryStatus.Sent, result.Status);
        Assert.Equal(SafeApnsId, result.ProviderMessageId);
        Assert.Equal(1, fixture.Handler.Calls);
        Assert.Equal($"https://{(environment == ApnsEnvironment.Development ? "api.sandbox" : "api")}.push.apple.com/3/device/{DeviceToken}", fixture.Handler.Uri);
        Assert.StartsWith("bearer ", fixture.Handler.Authorization, StringComparison.Ordinal);
        fixture.AssertNoSensitiveLogs();

        // Other clients and application warnings/errors retain their normal logging.
        using var client = fixture.Provider.GetRequiredService<IHttpClientFactory>().CreateClient("unrelated");
        using var response = await client.GetAsync("https://example.test/safe");
        Assert.Contains(fixture.Logs.Entries, entry => entry.Category == "System.Net.Http.HttpClient.unrelated.ClientHandler");
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "BadDeviceToken", PushSendFailureCodes.BadDeviceToken, LogLevel.Warning)]
    [InlineData(HttpStatusCode.Forbidden, "InvalidProviderToken", PushSendFailureCodes.ThirdPartyAuthError, LogLevel.Error)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "ServiceUnavailable", PushSendFailureCodes.Unavailable, LogLevel.Warning)]
    public async Task Rejection_KeepsSafeDiagnostics(HttpStatusCode status, string reason, string code, LogLevel expectedLevel)
    {
        using var fixture = new Fixture((_, _) => Response(status, reason, SafeApnsId));
        Assert.Equal(code, (await fixture.SendAsync()).FailureCode);
        Assert.Contains(fixture.Logs.Entries, entry => entry.Level == LogLevel.Warning
            && entry.Text.Contains(reason, StringComparison.Ordinal) && entry.Text.Contains(SafeApnsId, StringComparison.Ordinal));
        Assert.Contains(fixture.Logs.Entries, entry => entry.Level == expectedLevel);
        fixture.AssertNoSensitiveLogs();
    }

    [Theory]
    [InlineData("token")]
    [InlineData("jwt")]
    [InlineData("key")]
    public async Task UntrustedResponseFields_CannotEchoSensitiveDataIntoWarnings(string sensitiveKind)
    {
        using var fixture = new Fixture((_, key) =>
        {
            var sensitive = sensitiveKind switch { "token" => DeviceToken, "jwt" => "synthetic.provider.jwt", _ => key };
            return Response(HttpStatusCode.BadRequest, sensitive, sensitive);
        });
        Assert.Equal(PushSendFailureCodes.InvalidArgument, (await fixture.SendAsync()).FailureCode);
        Assert.Contains(fixture.Logs.Entries, entry => entry.Level == LogLevel.Warning && entry.Text.Contains("400", StringComparison.Ordinal));
        fixture.AssertNoSensitiveLogs();
        Assert.DoesNotContain("synthetic.provider.jwt", fixture.Logs.AllText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TransportAndUnexpectedExceptions_NeverLogExceptionMessagesOrUris(bool unexpected)
    {
        using var fixture = new Fixture((request, key) =>
        {
            var unsafeMessage = $"{request.RequestUri} {request.Headers.Authorization} {key}";
            throw unexpected ? new InvalidOperationException(unsafeMessage) : new HttpRequestException(unsafeMessage);
        });
        Assert.Equal(unexpected ? PushSendFailureCodes.UnknownError : PushSendFailureCodes.Unavailable, (await fixture.SendAsync()).FailureCode);
        Assert.Contains(fixture.Logs.Entries, entry => entry.Level == (unexpected ? LogLevel.Error : LogLevel.Warning));
        fixture.AssertNoSensitiveLogs();
    }

    private static HttpResponseMessage Response(HttpStatusCode status, string? reason, string id)
    {
        var response = new HttpResponseMessage(status) { Content = new StringContent(JsonSerializer.Serialize(new { reason })) };
        response.Headers.TryAddWithoutValidation("apns-id", id);
        return response;
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string privateKey;
        public CapturingLogs Logs { get; } = new();
        public MockApns Handler { get; }
        public ServiceProvider Provider { get; }

        public Fixture(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
        {
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            privateKey = key.ExportPkcs8PrivateKeyPem();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:JupleDatabase"] = "Server=unused;Database=unused",
                ["Apns:KeyId"] = "ABC123DEFG",
                ["Apns:TeamId"] = "TEAM123456",
                ["Apns:PrivateKeyPem"] = privateKey,
            }).Build();
            var services = new ServiceCollection();
            services.AddLogging(builder => builder.SetMinimumLevel(LogLevel.Trace).AddProvider(Logs));
            services.AddSingleton(TimeProvider.System);
            services.AddInfrastructure(config);
            Handler = new MockApns(request => respond(request, privateKey));
            services.AddHttpClient(ApnsPushSender.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => Handler);
            services.AddHttpClient("unrelated").ConfigurePrimaryHttpMessageHandler(() => new MockApns(_ => new HttpResponseMessage(HttpStatusCode.OK)));
            Provider = services.BuildServiceProvider();
        }

        public async Task<PushSendResult> SendAsync(ApnsEnvironment environment = ApnsEnvironment.Development)
        {
            using var scope = Provider.CreateScope();
            var now = DateTimeOffset.UtcNow;
            return await scope.ServiceProvider.GetRequiredService<IPushSender>().SendAsync(
                new PushDeviceRegistration(1, PushPlatform.Ios, "synthetic-installation", DeviceToken, "ko", now, now, environment),
                new PushNotificationPayload("title", "body", "collectionItemsAdded", 42, new Dictionary<string, string>(), null, null));
        }

        public void AssertNoSensitiveLogs()
        {
            Assert.DoesNotContain(DeviceToken, Logs.AllText, StringComparison.Ordinal);
            Assert.DoesNotContain("/3/device/", Logs.AllText, StringComparison.Ordinal);
            Assert.DoesNotContain(privateKey, Logs.AllText, StringComparison.Ordinal);
            foreach (var keyLine in privateKey.Split('\n').Where(line => !line.StartsWith("-----", StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(line)))
                Assert.DoesNotContain(keyLine.Trim(), Logs.AllText, StringComparison.Ordinal);
            Assert.DoesNotContain(Provider.GetRequiredService<ApnsProviderTokenSource>().GetToken(), Logs.AllText, StringComparison.Ordinal);
            Assert.DoesNotContain(Logs.Entries, entry => entry.Category.StartsWith("System.Net.Http.HttpClient.apns.", StringComparison.Ordinal));
        }

        public void Dispose() => Provider.Dispose();
    }

    private sealed class MockApns(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? Uri { get; private set; }
        public string? Authorization { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Uri = request.RequestUri!.ToString();
            Authorization = request.Headers.Authorization?.ToString();
            return Task.FromResult(respond(request));
        }
    }

    private sealed class CapturingLogs : ILoggerProvider, ISupportExternalScope
    {
        private IExternalScopeProvider scopes = new LoggerExternalScopeProvider();
        public ConcurrentQueue<(string Category, LogLevel Level, string Text)> Entries { get; } = new();
        public string AllText => string.Join("\n", Entries.Select(entry => entry.Text));
        public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, this);
        public void SetScopeProvider(IExternalScopeProvider scopeProvider) => scopes = scopeProvider;
        public void Dispose() { }

        private sealed class CaptureLogger(string category, CapturingLogs owner) : ILogger
        {
            public bool IsEnabled(LogLevel level) => true;
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => owner.scopes.Push(state);
            public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var parts = new List<string> { formatter(state, exception), exception?.ToString() ?? "" };
                if (state is IEnumerable<KeyValuePair<string, object?>> values)
                    parts.AddRange(values.Select(value => $"{value.Key}={value.Value}"));
                owner.scopes.ForEachScope((scope, list) => list.Add(scope?.ToString() ?? ""), parts);
                owner.Entries.Enqueue((category, level, string.Join("\n", parts)));
            }
        }
    }
}
