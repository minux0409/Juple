using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Controllers;
using Juple.Application.Items;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Domain.Items;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.Items;

public sealed class ApplyInstagramMetadataCandidateServiceTests
{
    private const long OwnerId = 17;
    private const long OtherUserId = 99;
    private const string RealImage = "https://scontent.cdninstagram.com/v/t51/real.jpg";

    /// <summary>
    /// In-memory stand-in mirroring ItemStore's contract: owner + not-trashed lookup, and the real
    /// domain Item.ApplyAutomaticMetadata rule for the write.
    /// </summary>
    private sealed class FakeStore : IInstagramMetadataCandidateStore
    {
        public Dictionary<long, (long UserId, Item Item, bool Deleted)> Items { get; } = [];

        public int ApplyCalls { get; private set; }

        public long Add(long userId, string url, bool deleted = false)
        {
            var id = Items.Count + 1;
            Items[id] = (userId, new Item(userId, url, DateTimeOffset.UtcNow), deleted);
            return id;
        }

        public Item Get(long id) => Items[id].Item;

        private Item Owned(long userId, long itemId) =>
            Items.TryGetValue(itemId, out var entry) && entry.UserId == userId && !entry.Deleted
                ? entry.Item
                : throw new ItemNotFoundException();

        public Task<string> GetActiveItemUrlAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Owned(userId, itemId).Url);

        public Task<InstagramMetadataCandidateResult> ApplyAutomaticMetadataAsync(
            long userId, long itemId, NormalizedInstagramMetadata metadata, CancellationToken cancellationToken = default)
        {
            ApplyCalls++;
            var item = Owned(userId, itemId);
            var applied = item.ApplyAutomaticMetadata(metadata.Title, metadata.PreviewImageUrl);
            return Task.FromResult(new InstagramMetadataCandidateResult(item.Title, item.PreviewImageUrl, applied));
        }
    }

    private static (ApplyInstagramMetadataCandidateService Service, FakeStore Store) Create() =>
        CreateWith(new FakeStore());

    private static (ApplyInstagramMetadataCandidateService Service, FakeStore Store) CreateWith(FakeStore store) =>
        (new ApplyInstagramMetadataCandidateService(store, new InstagramMetadataCandidateNormalizer()), store);

    private static InstagramMetadataCandidateCommand Candidate(
        string? title = "someone on Instagram: \"caption\"",
        string? image = RealImage,
        string? url = "https://www.instagram.com/real_handle/p/ABC123xyz/") => new(title, image, url, null);

    [Fact]
    public async Task ApplyAsync_MatchingInstagramItem_AppliesNormalizedTitleAndImage()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/?igsh=abc");

        var result = await service.ApplyAsync(OwnerId, itemId, Candidate());

        Assert.True(result.Applied);
        Assert.Equal("real_handle on Instagram: \"caption\"", result.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
        Assert.Equal(result.Title, store.Get(itemId).Title);
    }

    [Fact]
    public async Task ApplyAsync_AnotherUsersItem_IsNotFound_AndUnchanged()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.ApplyAsync(OtherUserId, itemId, Candidate()));
        Assert.Null(store.Get(itemId).Title);
        Assert.Equal(0, store.ApplyCalls);
    }

    [Fact]
    public async Task ApplyAsync_TrashedItem_IsNotFound()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/", deleted: true);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.ApplyAsync(OwnerId, itemId, Candidate()));
    }

    [Fact]
    public async Task ApplyAsync_NonInstagramItem_IsRejected()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.youtube.com/watch?v=abc");

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(() => service.ApplyAsync(OwnerId, itemId, Candidate()));
        Assert.Equal("candidate", exception.Field);
        Assert.Equal(0, store.ApplyCalls);
    }

    [Fact]
    public async Task ApplyAsync_OgUrlForADifferentPost_IsRejected()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");

        await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.ApplyAsync(OwnerId, itemId, Candidate(url: "https://www.instagram.com/p/OTHER999/")));
        Assert.Null(store.Get(itemId).Title);
    }

    [Theory]
    [InlineData("ogTitle")]
    [InlineData("ogDescription")]
    [InlineData("ogImage")]
    [InlineData("ogUrl")]
    public async Task ApplyAsync_OversizedField_IsRejectedBeforeAnyLookup(string field)
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");
        var huge = new string('x', 5000);
        var candidate = field switch
        {
            "ogTitle" => Candidate(title: huge),
            "ogDescription" => new InstagramMetadataCandidateCommand(null, null, null, huge),
            "ogImage" => Candidate(image: huge),
            _ => Candidate(url: huge),
        };

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(() => service.ApplyAsync(OwnerId, itemId, candidate));
        Assert.Equal(field, exception.Field);
        Assert.Equal(0, store.ApplyCalls);
    }

    [Fact]
    public async Task ApplyAsync_GenericIconAndLoginTitle_AreNeverApplied()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/reel/ABC123xyz/");

        var result = await service.ApplyAsync(
            OwnerId, itemId, Candidate(title: "Log in • Instagram", image: "https://static.cdninstagram.com/rsrc.php/icon.png", url: null));

        Assert.False(result.Applied);
        Assert.Null(store.Get(itemId).Title);
        Assert.Null(store.Get(itemId).PreviewImageUrl);
    }

    [Fact]
    public async Task ApplyAsync_PreservesAUserEditedTitle_ButFillsTheMissingImage()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");
        store.Get(itemId).UpdateDetails("내가 붙인 제목", null);

        var result = await service.ApplyAsync(OwnerId, itemId, Candidate());

        Assert.True(result.Applied);
        Assert.Equal("내가 붙인 제목", result.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
    }

    [Fact]
    public async Task ApplyAsync_AfterTheRetryJobAlreadyFilledMetadata_ChangesNothing()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");
        store.Get(itemId).ApplyAutomaticMetadata("job title", "https://scontent.cdninstagram.com/v/job.jpg");

        var result = await service.ApplyAsync(OwnerId, itemId, Candidate());

        Assert.False(result.Applied);
        Assert.Equal("job title", result.Title);
        Assert.Equal("https://scontent.cdninstagram.com/v/job.jpg", result.PreviewImageUrl);
    }

    [Fact]
    public async Task ApplyAsync_IsIdempotent()
    {
        var (service, store) = Create();
        var itemId = store.Add(OwnerId, "https://www.instagram.com/p/ABC123xyz/");

        var first = await service.ApplyAsync(OwnerId, itemId, Candidate());
        var second = await service.ApplyAsync(OwnerId, itemId, Candidate());

        Assert.True(first.Applied);
        Assert.False(second.Applied);
        Assert.Equal(first.Title, second.Title);
        Assert.Equal(first.PreviewImageUrl, second.PreviewImageUrl);
    }

    [Fact]
    public void Endpoint_RequiresAnAuthenticatedJupleUser_AndUsesTheItemScopedRoute()
    {
        var authorize = typeof(ItemsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.JupleUser, authorize.Policy);

        var method = typeof(ItemsController).GetMethod(nameof(ItemsController.ApplyInstagramMetadataCandidateAsync))!;
        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("{id:long}/instagram-metadata-candidate", method.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }
}
