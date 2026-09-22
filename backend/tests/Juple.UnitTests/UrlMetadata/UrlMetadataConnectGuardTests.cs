using System.Net;
using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

/// <summary>
/// Exercises the exact function the guarded HttpClient's ConnectCallback calls on every connect -
/// including every redirect hop, since a new authority always triggers a fresh ConnectCallback
/// invocation (see UrlMetadataResolver's remarks) - with a fake DNS resolver so "a hostname
/// resolves to a private IP" is deterministic and does not depend on real DNS/network.
/// </summary>
public sealed class UrlMetadataConnectGuardTests
{
    [Fact]
    public async Task ConnectAsync_PassesOnlyTheCheckedIpAndOriginalPortToSocket_WithoutResolvingAgain()
    {
        var dns = new RebindingDnsResolver();
        IPEndPoint? connected = null;
        using var cancellation = new CancellationTokenSource();
        using var stream = await UrlMetadataConnectGuard.ConnectAsync(dns, new DnsEndPoint("public.example", 443),
            (endpoint, token) =>
            {
                Assert.Equal(cancellation.Token, token);
                connected = endpoint;
                return ValueTask.FromResult<Stream>(new MemoryStream());
            }, cancellation.Token);
        Assert.Equal(new IPEndPoint(IPAddress.Parse("8.8.8.8"), 443), connected);
        Assert.Equal(1, dns.Calls);
        await Assert.ThrowsAsync<UrlMetadataOperationException>(async () =>
            await UrlMetadataConnectGuard.ConnectAsync(dns, new DnsEndPoint("public.example", 443),
                (_, _) => throw new InvalidOperationException("Rebound host must never connect."), cancellation.Token));
        Assert.Equal(2, dns.Calls);
    }

    private sealed class RebindingDnsResolver : IDnsResolver
    {
        public int Calls { get; private set; }
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
            Task.FromResult(new[] { ++Calls == 1 ? IPAddress.Parse("8.8.8.8") : IPAddress.Loopback });
    }

    private sealed class FakeDnsResolver(params IPAddress[] addresses) : IDnsResolver
    {
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
            Task.FromResult(addresses);
    }

    private sealed class ThrowingDnsResolver : IDnsResolver
    {
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
            throw new System.Net.Sockets.SocketException();
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenHostResolvesToLocalhost_Throws()
    {
        var resolver = new FakeDnsResolver(IPAddress.Loopback);

        var exception = await Assert.ThrowsAsync<UrlMetadataOperationException>(
            () => UrlMetadataConnectGuard.ResolveAndValidateAsync(resolver, "localhost", CancellationToken.None));

        Assert.Equal("private_ip_blocked", exception.Category);
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenHostResolvesToRfc1918Address_Throws()
    {
        var resolver = new FakeDnsResolver(IPAddress.Parse("10.1.2.3"));

        var exception = await Assert.ThrowsAsync<UrlMetadataOperationException>(
            () => UrlMetadataConnectGuard.ResolveAndValidateAsync(
                resolver, "internal-redirect-target.example", CancellationToken.None));

        Assert.Equal("private_ip_blocked", exception.Category);
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenAnyResolvedAddressIsPrivate_ThrowsEvenIfAnotherIsPublic()
    {
        var resolver = new FakeDnsResolver(IPAddress.Parse("8.8.8.8"), IPAddress.Parse("192.168.1.1"));

        var exception = await Assert.ThrowsAsync<UrlMetadataOperationException>(
            () => UrlMetadataConnectGuard.ResolveAndValidateAsync(resolver, "multi-record.example", CancellationToken.None));

        Assert.Equal("private_ip_blocked", exception.Category);
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenHostResolvesToPublicAddress_ReturnsIt()
    {
        var resolver = new FakeDnsResolver(IPAddress.Parse("8.8.8.8"));

        var result = await UrlMetadataConnectGuard.ResolveAndValidateAsync(
            resolver, "public.example", CancellationToken.None);

        Assert.Equal(IPAddress.Parse("8.8.8.8"), result);
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenDnsReturnsNoRecords_Throws()
    {
        var resolver = new FakeDnsResolver();

        var exception = await Assert.ThrowsAsync<UrlMetadataOperationException>(
            () => UrlMetadataConnectGuard.ResolveAndValidateAsync(resolver, "no-records.example", CancellationToken.None));

        Assert.Equal("dns_no_records", exception.Category);
    }

    [Fact]
    public async Task ResolveAndValidateAsync_WhenDnsResolutionFails_Throws()
    {
        var exception = await Assert.ThrowsAsync<UrlMetadataOperationException>(
            () => UrlMetadataConnectGuard.ResolveAndValidateAsync(
                new ThrowingDnsResolver(), "unresolvable.example", CancellationToken.None));

        Assert.Equal("dns_resolution_failed", exception.Category);
    }
}
