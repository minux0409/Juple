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
