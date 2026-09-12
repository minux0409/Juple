using System.Net;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Dns.GetHostAddressesAsync also accepts a literal IP host and returns it as-is (no real DNS
/// query) - so UrlMetadataConnectGuard needs no separate literal-IP code path.
/// </summary>
public sealed class SystemDnsResolver : IDnsResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
        Dns.GetHostAddressesAsync(host, cancellationToken);
}
