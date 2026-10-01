using System.Text.Json;
using Juple.Api.Collections;
using Juple.Api.Controllers;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Reactions;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionItemReactionServiceTests
{
    [Fact]
    public void TheCatalog_HasUniqueShortStableKeys_InAFixedOrder_StartingWithTheQuickSet()
    {
        Assert.Equal(Keys.Distinct(StringComparer.Ordinal).Count(), Keys.Count);
        Assert.All(Keys, key =>
        {
            Assert.InRange(key.Length, 1, CollectionReactionCatalog.MaxKeyLength);
            Assert.Matches("^[a-z][A-Za-z0-9]*$", key);
        });
        // The six quick reactions come first, in this order.
        Assert.Equal(["heart", "thumbsUp", "check", "laugh", "wow", "sad"], Keys.Take(6));
        Assert.InRange(Keys.Count, 24, 40);
    }

    [Theory]
    [InlineData("heart", true)]
    [InlineData("pin", true)]
    [InlineData("Heart", false)]
    [InlineData("❤️", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyExactCatalogKeysAreKnown(string? key, bool known) =>
        Assert.Equal(known, CollectionReactionCatalog.IsKnown(key));

    [Fact]
    public async Task AnUnknownKey_IsRejectedBeforeAnythingElseIsAsked()
    {
        var access = new FakeAccess();
        var service = new CollectionItemReactionService(access, new FakeStore(), TimeProvider.System);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => service.SetAsync(1, 2, 3, "nope", null));

        Assert.Equal(0, access.Calls);
    }

    [Fact]
    public async Task TheContentGateComesFirst_SoANonMemberOrALockedCollectionNeverReachesTheStore()
    {
        var store = new FakeStore();
        var service = new CollectionItemReactionService(new FakeAccess { Throw = new CollectionNotFoundException() }, store, TimeProvider.System);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.SetAsync(1, 2, 3, "heart", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.DeleteAsync(1, 2, 3, null));

        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public async Task TheUnlockTokenIsPassedToTheGate()
    {
        var access = new FakeAccess();
        var service = new CollectionItemReactionService(access, new FakeStore(), TimeProvider.System);

        await service.SetAsync(1, 2, 3, "heart", "grant");

        Assert.Equal("grant", access.LastToken);
    }

    [Fact]
    public async Task ALinkThatIsNotInTheCollection_IsNotFound()
    {
        var service = new CollectionItemReactionService(new FakeAccess(), new FakeStore { IsLink = false }, TimeProvider.System);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.SetAsync(1, 2, 3, "heart", null));
    }

    [Fact]
    public async Task TheAnswerIsTheLinksReactionsAsTheyAreNow()
    {
        var store = new FakeStore { Summary = new CollectionItemReactionsDto([new ReactionCountDto("heart", 2)], "heart") };
        var service = new CollectionItemReactionService(new FakeAccess(), store, TimeProvider.System);

        var result = await service.SetAsync(1, 2, 3, "heart", null);

        Assert.Equal("heart", result.MyReaction);
        Assert.Equal(2, result.Reactions[0].Count);
        Assert.Empty((await new CollectionItemReactionService(new FakeAccess(), new FakeStore(), TimeProvider.System).DeleteAsync(1, 2, 3, null)).Reactions);
    }

    [Theory]
    [InlineData("""{"reactionKey":"heart"}""", "heart")]
    [InlineData("""{"reactionKey":null}""", null)]
    [InlineData("""{}""", null)]
    public void TheBodyBindsTheKey(string json, string? key) =>
        Assert.Equal(key, JsonSerializer.Deserialize<CollectionsController.SetReactionRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!.ReactionKey);

    [Theory]
    [InlineData("SetReactionAsync")]
    [InlineData("RemoveReactionAsync")]
    public void TheEndpointsDeclareNoOwnerOnlyPermission_TheServiceGatesThem(string actionName)
    {
        // Member endpoints: the service (content gate) decides - never an Owner-only attribute.
        var action = typeof(CollectionsController).GetMethod(actionName)!;
        Assert.Null(action.GetCustomAttributes(typeof(CollectionPermissionAttribute), true).FirstOrDefault());
    }

    private static IReadOnlyList<string> Keys => CollectionReactionCatalog.Keys;

    private sealed class FakeAccess : ICollectionAccessService
    {
        public Exception? Throw { get; init; }

        public int Calls { get; private set; }

        public string? LastToken { get; private set; }

        public Task<CollectionAccess> RequireAsync(long userId, long collectionId, CollectionPermission permission, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireUnlockedAsync(long userId, long collectionId, CollectionPermission permission, string? unlockToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireContentAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastToken = unlockToken;
            return Throw is null
                ? Task.FromResult(new CollectionAccess(collectionId, CollectionAccessRole.Contributor, false, 0))
                : Task.FromException<CollectionAccess>(Throw);
        }
    }

    private sealed class FakeStore : ICollectionItemReactionStore
    {
        public bool IsLink { get; init; } = true;

        public CollectionItemReactionsDto? Summary { get; init; }

        public int Writes { get; private set; }

        public Task<bool> SetAsync(long userId, long collectionId, long itemId, string key, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Writes++;
            return Task.FromResult(IsLink);
        }

        public Task DeleteAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default)
        {
            Writes++;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyDictionary<long, CollectionItemReactionsDto>> GetSummariesAsync(
            long userId, long collectionId, IReadOnlyCollection<long> itemIds, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyDictionary<long, CollectionItemReactionsDto>>(
                Summary is null ? new Dictionary<long, CollectionItemReactionsDto>() : itemIds.ToDictionary(id => id, _ => Summary));
    }
}
