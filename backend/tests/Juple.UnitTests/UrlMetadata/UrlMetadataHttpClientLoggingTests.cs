using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Juple.Application.UrlMetadata;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.UrlMetadata;

/// <summary>
/// Proves the actual DI-level fix (DependencyInjection.AddUrlMetadataResolver's
/// <c>.RemoveAllLoggers()</c> call) rather than only UrlMetadataResolver's own application-level
/// log - AddHttpClient's default LoggingHttpMessageHandlerBuilderFilter only ever runs inside the
/// real IHttpClientFactory pipeline, which UrlMetadataResolverTests deliberately bypasses (it
/// constructs `new HttpClient(stubHandler)` directly - see that class's own remarks), so it could
/// never have caught this leak or verified this fix. These tests build a small real
/// ServiceCollection with the identical AddHttpClient/.RemoveAllLoggers()/
/// ConfigurePrimaryHttpMessageHandler chain production code uses (only the primary handler itself
/// is swapped for a deterministic stub - no real socket/DNS activity), and inspect every log
/// message across every category the framework produced.
/// </summary>
public sealed class UrlMetadataHttpClientLoggingTests
{
    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, int, HttpResponseMessage> handler)
        : HttpMessageHandler
    {
        private int _callCount;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var callCount = Interlocked.Increment(ref _callCount);
            return Task.FromResult(handler(request, callCount));
        }
    }

    /// <summary>Captures every log message across every category - deliberately not filtered to
    /// UrlMetadataResolver's own category, since the whole point is to catch a leak from a
    /// *different* (framework-owned) logger category.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<string> _messages = [];
        private readonly object _gate = new();

        public IReadOnlyList<string> Messages
        {
            get
            {
                lock (_gate)
                {
                    return [.. _messages];
                }
            }
        }

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, this);

        public void Dispose() { }

        private void Record(string categoryName, string message)
        {
            lock (_gate)
            {
                _messages.Add($"[{categoryName}] {message}");
            }
        }

        private sealed class CapturingLogger(string categoryName, CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                owner.Record(categoryName, formatter(state, exception));

            private sealed class NullScope : IDisposable
            {
                public static readonly NullScope Instance = new();
                public void Dispose() { }
            }
        }
    }

    private static HttpResponseMessage HtmlResponse(string html)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(html)),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("text/html");
        return response;
    }

    private static ServiceProvider BuildProvider(
        Func<HttpRequestMessage, int, HttpResponseMessage> handler,
        CapturingLoggerProvider capturingProvider,
        bool applyRemoveAllLoggers)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            builder.SetMinimumLevel(LogLevel.Trace);
            builder.AddProvider(capturingProvider);
        });
        services.AddMemoryCache();
        services.AddSingleton(TimeProvider.System);

        var builder2 = services.AddHttpClient<IUrlMetadataResolver, UrlMetadataResolver>();
        if (applyRemoveAllLoggers)
        {
            builder2.RemoveAllLoggers();
        }
        builder2.ConfigurePrimaryHttpMessageHandler(() => new StubHttpMessageHandler(handler));

        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task WithRemoveAllLoggers_FrameworkNeverLogsTheRequestPath()
    {
        const string SensitivePath = "/private/user/very-secret-path-xyz123";
        var capturingProvider = new CapturingLoggerProvider();
        await using var provider = BuildProvider(
            (_, _) => HtmlResponse("<html><head><title>Ignored</title></head></html>"),
            capturingProvider,
            applyRemoveAllLoggers: true);
        var resolver = provider.GetRequiredService<IUrlMetadataResolver>();

        await resolver.ResolveAsync($"https://example.com{SensitivePath}");

        Assert.DoesNotContain(capturingProvider.Messages, message => message.Contains(SensitivePath));
    }

    [Fact]
    public async Task WithRemoveAllLoggers_ApplicationLevelSummaryLogStillFires()
    {
        // Guards against a trivially-"passing" fix that also silences UrlMetadataResolver's own
        // privacy-safe summary log - RemoveAllLoggers() must remove only the framework's two
        // default handlers, not observability entirely.
        var capturingProvider = new CapturingLoggerProvider();
        await using var provider = BuildProvider(
            (_, _) => HtmlResponse("<html><head><title>Ignored</title></head></html>"),
            capturingProvider,
            applyRemoveAllLoggers: true);
        var resolver = provider.GetRequiredService<IUrlMetadataResolver>();

        await resolver.ResolveAsync("https://example.com/some/path");

        Assert.Contains(
            capturingProvider.Messages,
            message => message.Contains("URL metadata resolve completed") && message.Contains("example.com"));
    }

    [Fact]
    public async Task WithoutRemoveAllLoggers_FrameworkWouldHaveLoggedThePath()
    {
        // The counterfactual: proves this suite actually exercises the real leak (and would have
        // failed before this round's fix), not a tautology that always passes regardless of the
        // handler chain.
        const string SensitivePath = "/private/user/very-secret-path-xyz123";
        var capturingProvider = new CapturingLoggerProvider();
        await using var provider = BuildProvider(
            (_, _) => HtmlResponse("<html><head><title>Ignored</title></head></html>"),
            capturingProvider,
            applyRemoveAllLoggers: false);
        var resolver = provider.GetRequiredService<IUrlMetadataResolver>();

        await resolver.ResolveAsync($"https://example.com{SensitivePath}");

        Assert.Contains(capturingProvider.Messages, message => message.Contains(SensitivePath));
    }

    [Fact]
    public async Task WithRemoveAllLoggers_RedirectHopTargetPathIsAlsoNeverLogged()
    {
        const string RedirectTargetPath = "/private/redirect-target-xyz789";
        var capturingProvider = new CapturingLoggerProvider();
        await using var provider = BuildProvider(
            (_, callCount) => callCount == 1
                ? new HttpResponseMessage(HttpStatusCode.Found)
                {
                    Headers = { Location = new Uri($"https://example.com{RedirectTargetPath}") },
                }
                : HtmlResponse("<html><head><title>Final</title></head></html>"),
            capturingProvider,
            applyRemoveAllLoggers: true);
        var resolver = provider.GetRequiredService<IUrlMetadataResolver>();

        var result = await resolver.ResolveAsync("https://example.com/start");

        Assert.Equal("Final", result.Title);
        Assert.DoesNotContain(capturingProvider.Messages, message => message.Contains(RedirectTargetPath));
    }
}
