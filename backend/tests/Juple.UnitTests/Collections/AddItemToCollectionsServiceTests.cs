using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollections;
using Juple.Application.Collections.Locking;
using Juple.Application.Images;
using Juple.Application.Items;

namespace Juple.UnitTests.Collections;

/// <summary>
/// 다른 컬렉션에 복제: one of my Items into several of my OWN Collections - each behind the single add's
/// own gate (a locked one needs its own grant), all checked before anything is written, an existing
/// membership skipped, and a new-link notification only for a Collection that actually gained it.
/// </summary>
public sealed class AddItemToCollectionsServiceTests
{
    private const long Me = 1;
    private const long Friend = 2;
    private const long Item = 500;
    private const long Mine = 10;
    private const long MineShared = 11;
    private const long MineLocked = 12;
    private const long MineOther = 13;
    private const long FriendsSharedWithMe = 20;

    private readonly InMemoryCollectionAccessStore _accessStore = new();
    private readonly RecordingItemStore _itemStore = new();
    private readonly CollectionLockScopeTests.RecordingSocialPublisher _publisher = new();
    private readonly RecordingTransactions _transactions;

    public AddItemToCollectionsServiceTests()
    {
        _accessStore.Add(Mine, Me);
        _accessStore.Add(MineShared, Me, Friend);
        _accessStore.Add(MineLocked, Me);
        _accessStore.SetLock(MineLocked, isLocked: true, lockVersion: 3);
        _accessStore.Add(MineOther, Me);
        _accessStore.Add(FriendsSharedWithMe, Friend, Me);
        _transactions = new RecordingTransactions(_itemStore, _publisher);
    }

    private AddItemToCollectionsService Service() =>
        new(new CollectionAccessService(_accessStore, new FakeUnlockTokenProtector(), TimeProvider.System), _itemStore, _transactions, TimeProvider.System, _publisher);

    private static string LockGrant(long collectionId, int version) =>
        FakeUnlockTokenProtector.Token(collectionId, CollectionUnlockSubject.ForUser(Me), version);

    [Fact]
    public async Task AddsToEveryChosenCollection_OnceEach_AndNotifiesEachThatGainedIt()
    {
        var result = await Service().AddAsync(Me, Item, [Mine, MineShared, MineOther, MineShared], null);

        Assert.Equal(new AddItemToCollectionsResult(3, 0), result);
        Assert.Equal([(Mine, Item), (MineShared, Item), (MineOther, Item)], _itemStore.Added);
        Assert.Equal([(Me, Mine), (Me, MineShared), (Me, MineOther)], _publisher.Changes);
        Assert.Equal(["items-added:1:10:1:named", "items-added:1:11:1:named", "items-added:1:13:1:named"], _publisher.Events);
    }

    [Fact]
    public async Task AlreadyThere_IsSkipped_WithoutANotification()
    {
        _itemStore.AlreadyIn.Add(MineShared);

        var result = await Service().AddAsync(Me, Item, [Mine, MineShared], null);

        Assert.Equal(new AddItemToCollectionsResult(1, 1), result);
        Assert.Equal(["items-added:1:10:1:named"], _publisher.Events);
        Assert.Equal([(Me, Mine)], _publisher.Changes);
    }

    [Fact]
    public async Task AllAlreadyThere_ChangesNothing_AndNotifiesNobody()
    {
        _itemStore.AlreadyIn.UnionWith([Mine, MineOther]);

        var result = await Service().AddAsync(Me, Item, [Mine, MineOther], null);

        Assert.Equal(new AddItemToCollectionsResult(0, 2), result);
        Assert.Empty(_publisher.Events);
        Assert.Empty(_publisher.Changes);
    }

    [Fact]
    public async Task OnlyMyOwnCollections_AndNothingIsWrittenWhenAnyIsRefused()
    {
        // Shared with me (even as a Contributor) is not a destination here.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().AddAsync(Me, Item, [Mine, FriendsSharedWithMe], null));
        // Someone else's, or one that does not exist.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().AddAsync(Friend, Item, [Mine], null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().AddAsync(Me, Item, [Mine, 999], null));

        Assert.Empty(_itemStore.Added);
        Assert.Empty(_publisher.Events);
    }

    [Fact]
    public async Task ALockedDestination_NeedsItsOwnGrant_AndWithoutItNothingIsWritten()
    {
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().AddAsync(Me, Item, [Mine, MineLocked], null));
        // A grant for a different Collection, or an outdated lock version, does not open this one.
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().AddAsync(
            Me, Item, [Mine, MineLocked], new Dictionary<long, string> { [MineLocked] = LockGrant(Mine, 3) }));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().AddAsync(
            Me, Item, [Mine, MineLocked], new Dictionary<long, string> { [MineLocked] = LockGrant(MineLocked, 2) }));
        Assert.Empty(_itemStore.Added);

        var result = await Service().AddAsync(
            Me, Item, [Mine, MineLocked], new Dictionary<long, string> { [MineLocked] = LockGrant(MineLocked, 3) });

        Assert.Equal(new AddItemToCollectionsResult(2, 0), result);
        Assert.Equal([(Mine, Item), (MineLocked, Item)], _itemStore.Added);
    }

    [Fact]
    public async Task TheWritesAndTheirNotifications_AreOneTransaction_CommittedOnceAtTheEnd()
    {
        await Service().AddAsync(Me, Item, [Mine, MineShared], null);

        Assert.Equal(1, _transactions.Begun);
        Assert.Equal(1, _transactions.Committed);
        Assert.Equal(1, _transactions.Disposed);
        // Everything happened inside it: both links and both notifications were written before the commit.
        Assert.Equal((2, 2), _transactions.AtCommit);
    }

    [Fact]
    public async Task ARefusedDestination_NeverEvenOpensATransaction()
    {
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().AddAsync(Me, Item, [Mine, FriendsSharedWithMe], null));

        Assert.Equal(0, _transactions.Begun);
    }

    [Fact]
    public async Task AFailureDuringTheWrites_LeavesTheTransactionUncommitted_SoEverythingRollsBack()
    {
        _itemStore.FailOnAddNumber = 2;

        await Assert.ThrowsAsync<InvalidOperationException>(() => Service().AddAsync(Me, Item, [Mine, MineShared, MineOther], null));

        Assert.Equal(1, _transactions.Begun);
        Assert.Equal(0, _transactions.Committed);
        Assert.Equal(1, _transactions.Disposed); // disposed uncommitted = rolled back
        Assert.Empty(_publisher.Events);
    }

    [Fact]
    public async Task AFailureWhileWritingTheNotifications_AlsoLeavesItUncommitted()
    {
        var failingPublisher = new ThrowingPublisher();
        var service = new AddItemToCollectionsService(
            new CollectionAccessService(_accessStore, new FakeUnlockTokenProtector(), TimeProvider.System), _itemStore, _transactions, TimeProvider.System, failingPublisher);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.AddAsync(Me, Item, [Mine, MineShared], null));

        Assert.Equal(2, _itemStore.Added.Count); // written inside the transaction...
        Assert.Equal(0, _transactions.Committed); // ...which was never committed
        Assert.Equal(1, _transactions.Disposed);
    }

    [Fact]
    public async Task SomeoneElsesItem_IsNotFound()
    {
        _itemStore.OwnedItem = false;

        await Assert.ThrowsAsync<ItemNotFoundException>(() => Service().AddAsync(Me, Item, [Mine], null));
        Assert.Empty(_publisher.Events);
    }

    [Fact]
    public async Task TheRequest_IsBounded()
    {
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().AddAsync(Me, Item, [], null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().AddAsync(Me, Item, null, null));

        var tooMany = Enumerable.Range(1, AddItemToCollectionsService.MaxCollectionsPerRequest + 1).Select(id => 1000L + id).ToList();
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().AddAsync(Me, Item, tooMany, null));

        // Exactly the limit is fine (and repeats of one id count once).
        var limit = Enumerable.Range(1, AddItemToCollectionsService.MaxCollectionsPerRequest).Select(id => 1000L + id).ToList();
        limit.ForEach(id => _accessStore.Add(id, Me));
        var result = await Service().AddAsync(Me, Item, [.. limit, limit[0]], null);
        Assert.Equal(AddItemToCollectionsService.MaxCollectionsPerRequest, result.Added);
    }

    private sealed class RecordingItemStore : ICollectionItemStore
    {
        public List<(long CollectionId, long ItemId)> Added { get; } = [];

        public HashSet<long> AlreadyIn { get; } = [];

        public bool OwnedItem { get; set; } = true;

        /// <summary>The Nth AddAsync call (1-based) fails like a broken database write; 0 = never.</summary>
        public int FailOnAddNumber { get; set; }

        private int _addCalls;

        public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
            long userId, long collectionId, CollectionItemPageCursor? cursor, int limit, CollectionItemSort sort = CollectionItemSort.Manual, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<SharedCollectionItemDto?> GetSharedItemAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<bool> AddAsync(long userId, long collectionId, long itemId, DateTimeOffset addedAtUtc, CancellationToken cancellationToken = default)
        {
            if (!OwnedItem)
            {
                throw new ItemNotFoundException();
            }

            if (++_addCalls == FailOnAddNumber)
            {
                throw new InvalidOperationException("database write failed");
            }

            if (AlreadyIn.Contains(collectionId))
            {
                return Task.FromResult(false);
            }

            Added.Add((collectionId, itemId));
            return Task.FromResult(true);
        }

        public Task RemoveAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task MoveItemAsync(long userId, long collectionId, long itemId, long? afterItemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    /// <summary>Counts begin/commit/dispose, and how many writes and new-link notifications preceded the commit.</summary>
    private sealed class RecordingTransactions(RecordingItemStore store, CollectionLockScopeTests.RecordingSocialPublisher publisher) : ICollectionWriteTransactions
    {
        public RecordingItemStore Store { get; } = store;

        public CollectionLockScopeTests.RecordingSocialPublisher Publisher { get; } = publisher;

        public int Begun { get; private set; }

        public int Committed { get; private set; }

        public int Disposed { get; private set; }

        public (int Adds, int Notifications)? AtCommit { get; private set; }

        public Task<ICollectionWriteTransaction> BeginAsync(CancellationToken cancellationToken = default)
        {
            Begun++;
            return Task.FromResult<ICollectionWriteTransaction>(new Transaction(this));
        }

        private sealed class Transaction(RecordingTransactions owner) : ICollectionWriteTransaction
        {
            public Task CommitAsync(CancellationToken cancellationToken = default)
            {
                owner.Committed++;
                owner.AtCommit = (owner.Store.Added.Count, owner.Publisher.Events.Count);
                return Task.CompletedTask;
            }

            public ValueTask DisposeAsync()
            {
                owner.Disposed++;
                return ValueTask.CompletedTask;
            }
        }
    }

    /// <summary>Writes nothing and fails - like the database refusing a notification row.</summary>
    private sealed class ThrowingPublisher : Juple.Application.Notifications.ISocialNotificationPublisher
    {
        public Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, bool accepted, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("notification write failed");

        public Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task CollectionItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("notification write failed");
    }
}

/// <summary>The request body as ASP.NET binds it (web JSON defaults): per-destination grants keyed by Collection id.</summary>
public sealed class AddItemToCollectionsRequestBindingTests
{
    [Fact]
    public void CollectionIds_AndPerCollectionGrants_Bind()
    {
        var request = System.Text.Json.JsonSerializer.Deserialize<Juple.Api.Controllers.ItemCollectionsController.AddItemToCollectionsRequest>(
            """{"collectionIds":[10,12],"unlockTokens":{"12":"grant-12"}}""",
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        Assert.NotNull(request);
        Assert.Equal([10L, 12L], request.CollectionIds);
        Assert.Equal("grant-12", request.UnlockTokens![12]);
    }
}

/// <summary>
/// The app posts to exactly this route (collectionsApi.addItemToCollections). A server without it answers
/// 404, which the app can only show as "복제하지 못했어요" - so the route itself is pinned here.
/// </summary>
public sealed class ItemCollectionsRouteTests
{
    [Fact]
    public void TheBatchEndpoint_IsAPost_On_ApiV1ItemsItemIdCollections_ForSignedInUsers()
    {
        var controller = typeof(Juple.Api.Controllers.ItemCollectionsController);
        var route = Assert.Single(controller.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.RouteAttribute), inherit: false));
        Assert.Equal("api/v1/items/{itemId:long}/collections", ((Microsoft.AspNetCore.Mvc.RouteAttribute)route).Template);
        var authorize = Assert.Single(controller.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), inherit: false));
        Assert.Equal(Juple.Api.Authentication.AuthorizationPolicies.JupleUser, ((Microsoft.AspNetCore.Authorization.AuthorizeAttribute)authorize).Policy);

        var action = controller.GetMethod(nameof(Juple.Api.Controllers.ItemCollectionsController.AddAsync))!;
        var post = Assert.Single(action.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.HttpPostAttribute), inherit: false));
        Assert.Null(((Microsoft.AspNetCore.Mvc.HttpPostAttribute)post).Template);
    }
}
