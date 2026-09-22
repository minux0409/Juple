using Juple.Application.UrlMetadata;
using Juple.Application.UrlMetadata.ResolveUrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class ResolveUrlMetadataServiceTests
{
    private sealed class FakeUrlMetadataResolver : IUrlMetadataResolver
    {
        public string? LastUrl { get; private set; }

        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default)
        {
            LastUrl = url;
            return Task.FromResult(new UrlMetadataResult("Resolved Title", UrlMetadataSource.OpenGraph, null));
        }
    }

    [Fact]
    public async Task ResolveAsync_DelegatesTrimmedUrlToResolver()
    {
        var resolver = new FakeUrlMetadataResolver();
        var service = new ResolveUrlMetadataService(resolver);

        var result = await service.ResolveAsync(new ResolveUrlMetadataCommand("  https://example.com/a  "));

        Assert.Equal("https://example.com/a", resolver.LastUrl);
        Assert.Equal("Resolved Title", result.Title);
    }

    /// <summary>
    /// Regression coverage: a real Instagram app share produces a tokenized URL
    /// (?igsh=... or similar) - ValidateUrl must only ever trim surrounding whitespace, never
    /// touch the query string, or that token (needed for Instagram to resolve the actual shared
    /// post rather than a generic page) would be silently dropped before the resolver ever sees it.
    /// </summary>
    [Fact]
    public async Task ResolveAsync_PreservesTheFullQueryStringUnchanged_IncludingATokenizedShareParameter()
    {
        var resolver = new FakeUrlMetadataResolver();
        var service = new ResolveUrlMetadataService(resolver);
        const string tokenizedUrl = "https://www.instagram.com/p/ABC123xyz/?igsh=dGVzdHRva2Vu&utm_source=ig_web_copy_link";

        await service.ResolveAsync(new ResolveUrlMetadataCommand(tokenizedUrl));

        Assert.Equal(tokenizedUrl, resolver.LastUrl);
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
    public async Task ResolveAsync_WhenUrlIsInvalidOrDisallowedScheme_ThrowsInvalidUrlMetadataRequest(string? url)
    {
        var service = new ResolveUrlMetadataService(new FakeUrlMetadataResolver());

        var exception = await Assert.ThrowsAsync<InvalidUrlMetadataRequestException>(
            () => service.ResolveAsync(new ResolveUrlMetadataCommand(url)));

        Assert.Equal("url", exception.Field);
    }

    [Fact]
    public async Task ResolveAsync_WhenUrlUsesNonDefaultPort_ThrowsInvalidUrlMetadataRequest()
    {
        var service = new ResolveUrlMetadataService(new FakeUrlMetadataResolver());

        await Assert.ThrowsAsync<InvalidUrlMetadataRequestException>(
            () => service.ResolveAsync(new ResolveUrlMetadataCommand("https://example.com:8443/a")));
    }

    [Fact]
    public async Task ResolveAsync_WhenUrlExceedsMaxLength_ThrowsInvalidUrlMetadataRequest()
    {
        var service = new ResolveUrlMetadataService(new FakeUrlMetadataResolver());
        var tooLongUrl = "https://example.com/" + new string('a', 4096);

        await Assert.ThrowsAsync<InvalidUrlMetadataRequestException>(
            () => service.ResolveAsync(new ResolveUrlMetadataCommand(tooLongUrl)));
    }

    [Fact]
    public async Task ResolveAsync_AllowsExplicitDefaultPort()
    {
        var resolver = new FakeUrlMetadataResolver();
        var service = new ResolveUrlMetadataService(resolver);

        await service.ResolveAsync(new ResolveUrlMetadataCommand("https://example.com:443/a"));

        Assert.Equal("https://example.com:443/a", resolver.LastUrl);
    }
}
