using Juple.Application.UrlMetadata;
using Juple.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Juple.UnitTests.UrlMetadata;

public sealed class UrlMetadataTransportTests
{
    [Fact]
    public void ProductionTransport_DisablesProxyRedirectsAndPooling_AndPinsConnections()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["ConnectionStrings:JupleDatabase"] = "Server=unused;Database=unused" }).Build());
        using var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IHttpMessageHandlerFactory>();
        var metadata = Primary(factory.CreateHandler(nameof(IUrlMetadataResolver)));
        Assert.False(metadata.AllowAutoRedirect);
        Assert.False(metadata.UseProxy);
        Assert.Equal(TimeSpan.Zero, metadata.PooledConnectionLifetime);
        Assert.NotNull(metadata.ConnectCallback);
        Assert.Null(metadata.SslOptions.RemoteCertificateValidationCallback);
        Assert.Equal(TimeSpan.FromSeconds(5), metadata.ConnectTimeout);
    }

    private static SocketsHttpHandler Primary(HttpMessageHandler handler)
    {
        while (handler is DelegatingHandler delegating)
        {
            Assert.DoesNotContain("Logging", handler.GetType().Name);
            handler = delegating.InnerHandler!;
        }
        return Assert.IsType<SocketsHttpHandler>(handler);
    }
}
