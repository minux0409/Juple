using Juple.Application.UrlSafety;
using Juple.Application.UrlSafety.CheckUrlSafety;

namespace Juple.UnitTests.UrlSafety;

public sealed class CheckUrlSafetyServiceTests
{
    private sealed class FakeUrlSafetyChecker : IUrlSafetyChecker
    {
        public string? LastUrl { get; private set; }

        public Task<UrlSafetyResult> CheckAsync(string url, CancellationToken cancellationToken = default)
        {
            LastUrl = url;
            return Task.FromResult(new UrlSafetyResult(UrlSafetyStatus.NoKnownThreat, []));
        }
    }

    [Fact]
    public async Task CheckAsync_DelegatesTrimmedUrlToChecker()
    {
        var checker = new FakeUrlSafetyChecker();
        var service = new CheckUrlSafetyService(checker);

        var result = await service.CheckAsync(new CheckUrlSafetyCommand("  https://example.com/a  "));

        Assert.Equal("https://example.com/a", checker.LastUrl);
        Assert.Equal(UrlSafetyStatus.NoKnownThreat, result.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    [InlineData("ftp://example.com/a")]
    [InlineData("file:///etc/passwd")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,<script>1</script>")]
    public async Task CheckAsync_WhenUrlIsInvalidOrDisallowedScheme_ThrowsInvalidUrlSafetyRequest(string? url)
    {
        var service = new CheckUrlSafetyService(new FakeUrlSafetyChecker());

        var exception = await Assert.ThrowsAsync<InvalidUrlSafetyRequestException>(
            () => service.CheckAsync(new CheckUrlSafetyCommand(url)));

        Assert.Equal("url", exception.Field);
    }

    [Fact]
    public async Task CheckAsync_WhenUrlUsesNonDefaultPort_ThrowsInvalidUrlSafetyRequest()
    {
        var service = new CheckUrlSafetyService(new FakeUrlSafetyChecker());

        await Assert.ThrowsAsync<InvalidUrlSafetyRequestException>(
            () => service.CheckAsync(new CheckUrlSafetyCommand("https://example.com:8443/a")));
    }

    [Fact]
    public async Task CheckAsync_WhenUrlExceedsMaxLength_ThrowsInvalidUrlSafetyRequest()
    {
        var service = new CheckUrlSafetyService(new FakeUrlSafetyChecker());
        var tooLongUrl = "https://example.com/" + new string('a', 4096);

        await Assert.ThrowsAsync<InvalidUrlSafetyRequestException>(
            () => service.CheckAsync(new CheckUrlSafetyCommand(tooLongUrl)));
    }

    [Fact]
    public async Task CheckAsync_AllowsExplicitDefaultPort()
    {
        var checker = new FakeUrlSafetyChecker();
        var service = new CheckUrlSafetyService(checker);

        await service.CheckAsync(new CheckUrlSafetyCommand("https://example.com:443/a"));

        Assert.Equal("https://example.com:443/a", checker.LastUrl);
    }
}
