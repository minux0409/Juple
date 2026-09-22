using Juple.Application.UrlSafety;

namespace Juple.UnitTests;

internal sealed class FakeUrlSafetyChecker(UrlSafetyStatus status = UrlSafetyStatus.NoKnownThreat) : IUrlSafetyChecker
{
    public string? LastUrl { get; private set; }
    public Task<UrlSafetyResult> CheckAsync(string url, CancellationToken cancellationToken = default)
    {
        LastUrl = url;
        return Task.FromResult(new UrlSafetyResult(status, []));
    }
}
