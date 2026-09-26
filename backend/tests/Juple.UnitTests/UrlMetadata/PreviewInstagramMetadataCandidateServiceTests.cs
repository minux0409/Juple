using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Controllers;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;
using Juple.Domain.Items;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.UrlMetadata;

public sealed class PreviewInstagramMetadataCandidateServiceTests
{
    private const string SourceUrl = "https://www.instagram.com/p/ABC123xyz/?igsh=abc";
    private const string RealImage = "https://scontent.cdninstagram.com/v/t51/real.jpg";

    private static readonly PreviewInstagramMetadataCandidateService Service = new(new InstagramMetadataCandidateNormalizer());

    private static InstagramMetadataCandidateCommand Candidate(
        string? title = "someone on Instagram: \"caption\"",
        string? image = RealImage,
        string? url = "https://www.instagram.com/real_handle/p/ABC123xyz/") => new(title, image, url, null);

    private static NormalizedInstagramMetadata Preview(InstagramMetadataCandidateCommand candidate, string? sourceUrl = SourceUrl) =>
        Service.Preview(new PreviewInstagramMetadataCandidateCommand(sourceUrl, candidate));

    private sealed class SpyNormalizer : IInstagramMetadataCandidateNormalizer
    {
        public List<(string ItemUrl, InstagramMetadataCandidateCommand Candidate)> Calls { get; } = [];

        public NormalizedInstagramMetadata? Normalize(string itemUrl, InstagramMetadataCandidateCommand candidate)
        {
            Calls.Add((itemUrl, candidate));
            return new NormalizedInstagramMetadata("spy title", null);
        }
    }

    [Fact]
    public void Preview_SamePost_ReturnsNormalizedTitleAndImage()
    {
        var result = Preview(Candidate());

        Assert.Equal("real_handle on Instagram: \"caption\"", result.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
    }

    [Fact]
    public void Preview_WithoutOgUrl_StillNormalizes()
    {
        var result = Preview(Candidate(url: null));

        Assert.NotNull(result.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=abc")]
    [InlineData("https://www.instagram.com/real_handle/")]
    [InlineData("not a url")]
    public void Preview_NonInstagramContentSourceUrl_IsRejected(string sourceUrl)
    {
        var exception = Assert.Throws<InvalidUrlMetadataRequestException>(() => Preview(Candidate(), sourceUrl));
        Assert.Equal("candidate", exception.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public void Preview_MissingSourceUrl_IsRejected(string? sourceUrl)
    {
        var exception = Assert.Throws<InvalidUrlMetadataRequestException>(() => Preview(Candidate(), sourceUrl));
        Assert.Equal("sourceUrl", exception.Field);
    }

    [Theory]
    [InlineData("https://www.instagram.com/p/OTHER999/")]
    [InlineData("http://www.instagram.com/p/ABC123xyz/")]
    public void Preview_OgUrlForADifferentPostOrNotHttps_IsRejected(string ogUrl)
    {
        Assert.Throws<InvalidUrlMetadataRequestException>(() => Preview(Candidate(url: ogUrl)));
    }

    [Fact]
    public void Preview_LoginTitleAndGenericIcon_AreDropped()
    {
        var result = Preview(Candidate(title: "Log in • Instagram", image: "https://static.cdninstagram.com/rsrc.php/icon.png", url: null));

        Assert.Null(result.Title);
        Assert.Null(result.PreviewImageUrl);
    }

    [Theory]
    [InlineData("http://scontent.cdninstagram.com/v/t51/real.jpg")]
    [InlineData("https://evil.example.com/real.jpg")]
    [InlineData("javascript:alert(1)")]
    public void Preview_ImageNotHttpsOrNotAnAllowedCdn_IsDropped_TitleKept(string image)
    {
        var result = Preview(Candidate(image: image));

        Assert.Null(result.PreviewImageUrl);
        Assert.NotNull(result.Title);
    }

    [Theory]
    [InlineData("ogTitle")]
    [InlineData("ogDescription")]
    [InlineData("ogImage")]
    [InlineData("ogUrl")]
    [InlineData("sourceUrl")]
    public void Preview_OversizedField_IsRejected(string field)
    {
        var huge = new string('x', 5000);
        var exception = Assert.Throws<InvalidUrlMetadataRequestException>(() => field switch
        {
            "ogTitle" => Preview(Candidate(title: huge)),
            "ogDescription" => Preview(new InstagramMetadataCandidateCommand(null, null, null, huge)),
            "ogImage" => Preview(Candidate(image: huge)),
            "ogUrl" => Preview(Candidate(url: huge)),
            _ => Preview(Candidate(), "https://www.instagram.com/p/ABC123xyz/?" + huge),
        });
        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void Preview_DelegatesToTheSharedNormalizer_WithTheTrimmedSourceUrlAndRawCandidate()
    {
        var spy = new SpyNormalizer();
        var candidate = Candidate();

        var result = new PreviewInstagramMetadataCandidateService(spy)
            .Preview(new PreviewInstagramMetadataCandidateCommand("  " + SourceUrl + " ", candidate));

        var call = Assert.Single(spy.Calls);
        Assert.Equal(SourceUrl, call.ItemUrl);
        Assert.Same(candidate, call.Candidate);
        Assert.Equal("spy title", result.Title);
    }

    [Fact]
    public void PreviewAndItemScopedApply_DependOnlyOnTheSameNormalizer_AndPreviewHasNoStore()
    {
        var previewParameters = typeof(PreviewInstagramMetadataCandidateService).GetConstructors().Single().GetParameters();
        Assert.Equal([typeof(IInstagramMetadataCandidateNormalizer)], previewParameters.Select(parameter => parameter.ParameterType));

        var applyParameters = typeof(ApplyInstagramMetadataCandidateService).GetConstructors().Single().GetParameters();
        Assert.Contains(typeof(IInstagramMetadataCandidateNormalizer), applyParameters.Select(parameter => parameter.ParameterType));
    }

    [Fact]
    public void Preview_MatchesWhatTheItemScopedApplyWouldStore()
    {
        var candidate = Candidate();
        var preview = Preview(candidate);

        var item = new Item(1, SourceUrl, DateTimeOffset.UtcNow);
        var normalized = new InstagramMetadataCandidateNormalizer().Normalize(item.Url, candidate)!;
        item.ApplyAutomaticMetadata(normalized.Title, normalized.PreviewImageUrl);

        Assert.Equal(item.Title, preview.Title);
        Assert.Equal(item.PreviewImageUrl, preview.PreviewImageUrl);
    }

    [Fact]
    public void Endpoint_RequiresAnAuthenticatedJupleUser_AndUsesTheUrlMetadataRoute()
    {
        var authorize = typeof(UrlMetadataController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.JupleUser, authorize.Policy);
        Assert.Equal("api/v1/url-metadata", typeof(UrlMetadataController).GetCustomAttribute<RouteAttribute>()!.Template);

        var method = typeof(UrlMetadataController).GetMethod(nameof(UrlMetadataController.PreviewInstagramCandidate))!;
        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("instagram-candidate-preview", method.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public void Endpoint_MapsARejectedCandidateTo400_AndAValidOneTo200()
    {
        var controller = new UrlMetadataController();

        var rejected = controller.PreviewInstagramCandidate(
            new UrlMetadataController.InstagramCandidatePreviewRequest(
                "https://www.youtube.com/watch?v=abc", "title", RealImage, null, null),
            Service);
        Assert.IsType<BadRequestObjectResult>(rejected.Result);

        var accepted = controller.PreviewInstagramCandidate(
            new UrlMetadataController.InstagramCandidatePreviewRequest(
                SourceUrl, "someone on Instagram: \"caption\"", RealImage, null, null),
            Service);
        var ok = Assert.IsType<OkObjectResult>(accepted.Result);
        var body = Assert.IsType<UrlMetadataController.InstagramCandidatePreviewResponse>(ok.Value);
        Assert.Equal(RealImage, body.PreviewImageUrl);
    }
}
