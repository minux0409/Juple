using System.Net;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Seam over Dns.GetHostAddressesAsync so UrlMetadataConnectGuard's SSRF-blocking logic can be
/// unit-tested deterministically (a fake resolver returning e.g. a 10.x address) instead of
/// depending on real DNS/network - see SystemDnsResolver for the real implementation.
/// </summary>
public interface IDnsResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken);
}
