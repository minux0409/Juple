using Juple.Application.Collections.Public;
using Microsoft.Extensions.Options;

namespace Juple.Api.Configuration;

/// <summary>The deployment's canonical share URL host: PublicWeb:BaseUrl from configuration - never a hard-coded host.</summary>
public sealed class ConfiguredCollectionShareUrlDetector(IOptions<PublicWebOptions> options) : ICollectionShareUrlDetector
{
    public string? FindPublicId(string? url) => CollectionShareUrl.TryGetPublicId(url, options.Value.BaseUrl);
}
