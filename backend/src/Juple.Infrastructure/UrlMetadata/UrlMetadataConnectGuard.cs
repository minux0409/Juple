using System.Net;
using System.Net.Sockets;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Resolves a request host to a single IP address safe for the Backend to connect to, or throws
/// UrlMetadataOperationException. Called directly from the guarded HttpClient's
/// SocketsHttpHandler.ConnectCallback (see DependencyInjection.AddUrlMetadataResolver) so the
/// guard runs against the exact IP the socket connects to, not a separately re-resolved one -
/// this closes the DNS-rebinding TOCTOU gap a "validate the host, then let HttpClient connect
/// normally" design would have (HttpClient would re-resolve DNS itself at connect time).
/// </summary>
public static class UrlMetadataConnectGuard
{
    public static async Task<IPAddress> ResolveAndValidateAsync(
        IDnsResolver dnsResolver,
        string host,
        CancellationToken cancellationToken)
    {
        IPAddress[] addresses;
        try
        {
            addresses = await dnsResolver.ResolveAsync(host, cancellationToken);
        }
        catch (Exception exception) when (exception is SocketException or ArgumentException)
        {
            throw new UrlMetadataOperationException("dns_resolution_failed");
        }

        if (addresses.Length == 0)
        {
            throw new UrlMetadataOperationException("dns_no_records");
        }

        // Every resolved address must be public - not just whichever one we pick to connect to -
        // otherwise a multi-A-record host could pass validation on a public record while another
        // client/retry connects via a private one.
        foreach (var address in addresses)
        {
            if (!PrivateNetworkAddressGuard.IsPublicRoutable(address))
            {
                throw new UrlMetadataOperationException("private_ip_blocked");
            }
        }

        return Array.Find(addresses, a => a.AddressFamily == AddressFamily.InterNetwork) ?? addresses[0];
    }
}
