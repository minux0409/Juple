using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Juple.Application.UrlSafety;
using Juple.Infrastructure.UrlSafety;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.UrlSafety;

/// <summary>
/// Exercises WebRiskUrlSafetyChecker's request-level policy (response normalization, caching,
/// error categorization, missing-credential short-circuit, privacy-safe logging) via a stub
/// HttpMessageHandler - never a real network call to Google Web Risk (see the class instructions:
/// external live provider tests are forbidden).
/// </summary>
public sealed class WebRiskUrlSafetyCheckerTests
{
    private const string ApiKey = "test-api-key";

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, int, HttpResponseMessage> handler)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(handler(request, CallCount));
        }
    }

    /// <summary>Records every formatted log message so tests can assert no sensitive value leaked.</summary>
    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<string> Messages { get; } = [];

        IDisposable ILogger.BeginScope<TState>(TState state) => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }

    private static WebRiskUrlSafetyChecker CreateChecker(
        Func<HttpRequestMessage, int, HttpResponseMessage> handler,
        out StubHttpMessageHandler stubHandler,
        out IMemoryCache memoryCache,
        out CapturingLogger<WebRiskUrlSafetyChecker> capturingLogger,
        string? apiKey = ApiKey)
    {
        stubHandler = new StubHttpMessageHandler(handler);
        var httpClient = new HttpClient(stubHandler) { BaseAddress = new Uri("https://webrisk.googleapis.com/") };
        memoryCache = new MemoryCache(new MemoryCacheOptions());
        capturingLogger = new CapturingLogger<WebRiskUrlSafetyChecker>();
        return new WebRiskUrlSafetyChecker(
            httpClient, new WebRiskOptions(apiKey), memoryCache, TimeProvider.System, capturingLogger);
    }

    private static HttpResponseMessage JsonResponse(string json)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(json)),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return response;
    }

    [Fact]
    public async Task CheckAsync_WhenProviderReportsThreats_NormalizesStatusAndCategories()
    {
        var checker = CreateChecker(
            (_, _) => JsonResponse(
                """{"threat":{"threatTypes":["MALWARE","SOCIAL_ENGINEERING"],"expireTime":"2099-01-01T00:00:00Z"}}"""),
            out _, out var cache, out _);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/bad");

            Assert.Equal(UrlSafetyStatus.ThreatDetected, result.Status);
            Assert.Contains(UrlThreatCategory.Malware, result.Threats);
            Assert.Contains(UrlThreatCategory.SocialEngineering, result.Threats);
        }
    }

    [Fact]
    public async Task CheckAsync_WhenProviderReportsNoMatch_ReturnsNoKnownThreat()
    {
        var checker = CreateChecker((_, _) => JsonResponse("{}"), out _, out var cache, out _);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/fine");

            Assert.Equal(UrlSafetyStatus.NoKnownThreat, result.Status);
            Assert.Empty(result.Threats);
        }
    }

    [Fact]
    public async Task CheckAsync_WhenRequestTimesOut_ReturnsCheckUnavailable_WithoutThrowing()
    {
        var checker = CreateChecker(
            (_, _) => throw new TaskCanceledException("simulated timeout"),
            out _, out var cache, out _);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/slow");

            Assert.Equal(UrlSafetyStatus.CheckUnavailable, result.Status);
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task CheckAsync_WhenProviderReturnsNonSuccess_ReturnsCheckUnavailable(HttpStatusCode statusCode)
    {
        var checker = CreateChecker(
            (_, _) => new HttpResponseMessage(statusCode), out _, out var cache, out _);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/rejected");

            Assert.Equal(UrlSafetyStatus.CheckUnavailable, result.Status);
        }
    }

    [Fact]
    public async Task CheckAsync_WhenProviderResponseIsMalformed_ReturnsCheckUnavailable_WithoutThrowing()
    {
        var checker = CreateChecker(
            (_, _) => JsonResponse("this is not valid json"), out _, out var cache, out _);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/malformed");

            Assert.Equal(UrlSafetyStatus.CheckUnavailable, result.Status);
        }
    }

    [Fact]
    public async Task CheckAsync_WhenApiKeyIsMissing_ReturnsCheckUnavailable_WithoutCallingProvider()
    {
        var checker = CreateChecker(
            (_, _) => throw new InvalidOperationException("Must never call the provider without an API key."),
            out var handler, out var cache, out _, apiKey: null);
        using (cache)
        {
            var result = await checker.CheckAsync("https://example.com/anything");

            Assert.Equal(UrlSafetyStatus.CheckUnavailable, result.Status);
            Assert.Equal(0, handler.CallCount);
        }
    }

    [Fact]
    public async Task CheckAsync_CachesNoThreatResult_SecondCallForSameUrlDoesNotRefetch()
    {
        var checker = CreateChecker((_, _) => JsonResponse("{}"), out var handler, out var cache, out _);
        using (cache)
        {
            var first = await checker.CheckAsync("https://example.com/cache-me");
            var second = await checker.CheckAsync("https://example.com/cache-me");

            Assert.Equal(UrlSafetyStatus.NoKnownThreat, first.Status);
            Assert.Equal(UrlSafetyStatus.NoKnownThreat, second.Status);
            Assert.Equal(1, handler.CallCount);
        }
    }

    [Fact]
    public async Task CheckAsync_CachesThreatResult_SecondCallForSameUrlDoesNotRefetch()
    {
        var checker = CreateChecker(
            (_, _) => JsonResponse(
                """{"threat":{"threatTypes":["MALWARE"],"expireTime":"2099-01-01T00:00:00Z"}}"""),
            out var handler, out var cache, out _);
        using (cache)
        {
            var first = await checker.CheckAsync("https://example.com/threat-cache-me");
            var second = await checker.CheckAsync("https://example.com/threat-cache-me");

            Assert.Equal(UrlSafetyStatus.ThreatDetected, first.Status);
            Assert.Equal(UrlSafetyStatus.ThreatDetected, second.Status);
            Assert.Equal(1, handler.CallCount);
        }
    }

    [Fact]
    public async Task CheckAsync_NeverLogsTheFullUrlOrApiKey_OnlyHostnameAndStatus()
    {
        const string SensitivePathSegment = "user-secret-token-abc123";
        var checker = CreateChecker(
            (_, _) => JsonResponse("{}"), out _, out var cache, out var logger);
        using (cache)
        {
            await checker.CheckAsync($"https://example.com/{SensitivePathSegment}?q={SensitivePathSegment}");

            Assert.NotEmpty(logger.Messages);
            Assert.All(logger.Messages, message =>
            {
                Assert.DoesNotContain(SensitivePathSegment, message);
                Assert.DoesNotContain(ApiKey, message);
            });
        }
    }
}
