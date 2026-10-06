using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Juple.Application.Collections.Public;
using Juple.Application.Identity;
using Juple.Application.Inbox;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.UrlMetadata;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Inbox;

/// <summary>
/// The product invariant "a Juple Collection share URL is never an ordinary saved link", on the server: the same
/// canonical host/path rule as the app, a stable 400 code, and nothing fetched or written when it applies.
/// </summary>
public sealed class CollectionShareUrlGuardTests
{
    private const string Host = "dev.juple.co.kr";
    private const string BaseUrl = "https://dev.juple.co.kr";
    private const string Id = "AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123";

    [Theory]
    [InlineData($"https://{Host}/c/{Id}")]
    [InlineData($"  https://{Host}/c/{Id}  ")]
    [InlineData($"https://{Host}/c/{Id}/")]
    [InlineData($"HTTPS://DEV.JUPLE.CO.KR/c/{Id}")]
    [InlineData($"https://{Host}/c/{Id}?utm_source=kakao&x=1")]
    [InlineData($"https://{Host}/c/{Id}#top")]
    [InlineData($"https://{Host}/c/{Id}/?a=b#c")]
    [InlineData($"https://{Host}:443/c/{Id}")]
    public void ACanonicalShareUrl_IsRecognized_WithItsPublicId(string url)
    {
        Assert.Equal(Id, CollectionShareUrl.TryGetPublicId(url, BaseUrl));
        Assert.Equal(Id, CollectionShareUrl.TryGetPublicId(url, Host)); // a bare host works too
    }

    [Theory]
    [InlineData($"https://{Host}.evil.test/c/{Id}")]       // deceptive suffix
    [InlineData($"https://evil-{Host}/c/{Id}")]            // deceptive prefix
    [InlineData($"https://sub.{Host}/c/{Id}")]             // another host
    [InlineData($"https://example.com/c/{Id}")]
    [InlineData($"http://{Host}/c/{Id}")]                  // HTTP
    [InlineData($"https://user:pw@{Host}/c/{Id}")]         // credentials
    [InlineData($"https://{Host}:8443/c/{Id}")]            // another port
    [InlineData($"https://{Host}/")]                       // ordinary pages of the same site
    [InlineData($"https://{Host}/about")]
    [InlineData($"https://{Host}/c")]
    [InlineData($"https://{Host}/c/")]
    [InlineData($"https://{Host}/c/{Id}/extra")]
    [InlineData($"https://{Host}/cc/{Id}")]
    [InlineData($"https://{Host}/c/short")]                // malformed id
    [InlineData($"https://{Host}/c/{Id}!!")]
    [InlineData($"https://{Host}/c/%E0%A4%A")]
    [InlineData("https://dev.juple.co.kr/c/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] // 69 chars
    [InlineData($"https://example.com/?next=https://{Host}/c/{Id}")]
    [InlineData($"see https://{Host}/c/{Id}")]             // display text around it
    [InlineData("")]
    [InlineData("not a url")]
    public void AnythingElse_IsNotACollectionShareUrl(string url)
    {
        Assert.Null(CollectionShareUrl.TryGetPublicId(url, BaseUrl));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithoutAConfiguredHost_NothingIsRecognized(string? configured)
    {
        Assert.Null(CollectionShareUrl.TryGetPublicId($"https://{Host}/c/{Id}", configured));
    }

    [Fact]
    public void TheHostComesFromConfiguration_NotFromSource()
    {
        var detector = new ConfiguredCollectionShareUrlDetector(Options.Create(new PublicWebOptions { BaseUrl = "https://app.example.org" }));

        Assert.Equal(Id, detector.FindPublicId($"https://app.example.org/c/{Id}"));
        Assert.Null(detector.FindPublicId($"https://{Host}/c/{Id}")); // the DEV host is not special anywhere
        // A local plain-http base URL (appsettings.Development) never matches: only https links are Collection links.
        var local = new ConfiguredCollectionShareUrlDetector(Options.Create(new PublicWebOptions { BaseUrl = "http://localhost:3000" }));
        Assert.Null(local.FindPublicId($"http://localhost:3000/c/{Id}"));
        Assert.Null(local.FindPublicId($"https://localhost:3000/c/{Id}"));
    }

    [Fact]
    public async Task SavingAShareUrl_IsRefused_BeforeAnythingIsFetchedOrStored()
    {
        var store = new RecordingStore();
        var service = new InboxEntrySaveService(store, TimeProvider.System, new NeverResolver(), new Detector());

        var exception = await Assert.ThrowsAsync<CollectionShareUrlNotSavableException>(() =>
            service.SaveAsync(1, new SaveInboxEntryCommand($"https://{Host}/c/{Id}?utm_source=x")));

        Assert.Equal(Id, exception.PublicId);
        Assert.Equal(0, store.Saves);
    }

    [Fact]
    public async Task AnOrdinaryUrl_OnTheSameSite_StillSaves()
    {
        var store = new RecordingStore();
        var service = new InboxEntrySaveService(store, TimeProvider.System, new OkResolver(), new Detector());

        await service.SaveAsync(1, new SaveInboxEntryCommand($"https://{Host}/articles/1"));
        await service.SaveAsync(1, new SaveInboxEntryCommand($"https://{Host}.evil.test/c/{Id}"));

        Assert.Equal(2, store.Saves);
    }

    [Fact]
    public async Task TheApi_AnswersA400_WithTheStableCode_AndThePublicId()
    {
        var controller = new InboxController();
        var save = new InboxEntrySaveService(new RecordingStore(), TimeProvider.System, new NeverResolver(), new Detector());
        var result = await controller.SaveAsync(
            new InboxController.SaveInboxEntryRequest($"https://{Host}/c/{Id}", null),
            new FakeIdentity(),
            new FakeCurrentUser(),
            save,
            NotWithCollections(save),
            CancellationToken.None);

        AssertShareUrlProblem(result);
    }

    [Fact]
    public async Task TheApi_WithCollections_KeepsTheSameGuard_AndWritesNothing()
    {
        var store = new RecordingStore();
        var save = new InboxEntrySaveService(store, TimeProvider.System, new NeverResolver(), new Detector());
        var result = await new InboxController().SaveAsync(
            new InboxController.SaveInboxEntryRequest($"https://{Host}/c/{Id}", null, CollectionIds: []),
            new FakeIdentity(),
            new FakeCurrentUser(),
            save,
            NotWithCollections(save),
            CancellationToken.None);

        AssertShareUrlProblem(result);
        Assert.Equal(0, store.Saves);
    }

    /// <summary>The 링크 저장 path; with no Collections chosen it never reaches any Collection dependency.</summary>
    private static SaveInboxEntryToCollectionsService NotWithCollections(IInboxEntrySaveService save) =>
        new(save, null!, null!, null!, TimeProvider.System);

    private static void AssertShareUrlProblem(IActionResult result)
    {
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var problem = Assert.IsType<ProblemDetails>(objectResult.Value);
        Assert.Equal("collectionShareUrlNotSavableAsLink", problem.Extensions["code"]);
        Assert.Equal(CollectionShareUrlNotSavableException.Code, problem.Extensions["code"]);
        Assert.Equal(Id, problem.Extensions["publicId"]);
    }

    private sealed class Detector : ICollectionShareUrlDetector
    {
        public string? FindPublicId(string? url) => CollectionShareUrl.TryGetPublicId(url, BaseUrl);
    }

    private sealed class NeverResolver : IUrlMetadataResolver
    {
        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default) =>
            throw new Xunit.Sdk.XunitException("A refused share URL must never be fetched.");
    }

    private sealed class OkResolver : IUrlMetadataResolver
    {
        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default) =>
            Task.FromResult(new UrlMetadataResult(null, null, null));
    }

    private sealed class RecordingStore : IInboxEntryStore
    {
        public int Saves { get; private set; }

        public Task<InboxEntrySaveResult> SaveAsync(long userId, string url, Guid? clientRequestId, DateTimeOffset savedAtUtc, CancellationToken cancellationToken = default)
        {
            Saves++;
            return Task.FromResult(new InboxEntrySaveResult(new InboxEntryDto(Saves, url, savedAtUtc), true));
        }
    }

    private sealed class FakeIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FakeCurrentUser : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CurrentJupleUser(1, "UTC", Juple.Domain.Users.UserPlan.Free));
    }
}
