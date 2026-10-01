using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.CopyItems;
using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

/// <summary>
/// 내 컬렉션으로 복사: out of a shared Collection the caller can view (shared with them, or their own -
/// then only others' links, enforced by the store), only into one of their OWN, each
/// side behind its own content gate (the source's share password, the destination's own lock) - and
/// one grouped new-link notification only when something was actually copied.
/// </summary>
public sealed class CopyCollectionItemsServiceTests
{
    private const long Owner = 1;
    private const long Recipient = 2;
    private const long Shared = 10;
    private const long ProtectedShared = 11;
    private const long RecipientOwn = 20;
    private const long RecipientOwnLocked = 21;

    private readonly InMemoryCollectionAccessStore _accessStore = new();
    private readonly RecordingCopyStore _copyStore = new();
    private readonly CollectionLockScopeTests.RecordingSocialPublisher _publisher = new();

    public CopyCollectionItemsServiceTests()
    {
        _accessStore.Add(Shared, Owner, Recipient);
        _accessStore.Add(ProtectedShared, Owner, Recipient).WithSharePassword(ProtectedShared, CollectionSharePasswordMode.PerCollection, version: 4);
        _accessStore.Add(RecipientOwn, Recipient, 3);
        _accessStore.Add(RecipientOwnLocked, Recipient);
        _accessStore.SetLock(RecipientOwnLocked, isLocked: true, lockVersion: 2);
    }

    private CopyCollectionItemsService Service() =>
        new(new CollectionAccessService(_accessStore, new FakeUnlockTokenProtector(), TimeProvider.System), _copyStore, TimeProvider.System, _publisher);

    [Fact]
    public async Task ACopy_ReachesTheStore_DeDuplicatesIds_AndNotifiesTheDestinationOnce()
    {
        _copyStore.Result = new CopyCollectionItemsResult(2, 1, 0);

        var result = await Service().CopyAsync(Recipient, Shared, [5, 6, 6, 7], RecipientOwn, null);

        Assert.Equal(new CopyCollectionItemsResult(2, 1, 0), result);
        Assert.Equal([5L, 6L, 7L], _copyStore.LastIds);
        Assert.Equal(["items-added:2:20:2:named"], _publisher.Events);
        Assert.Equal(new[] { (Recipient, RecipientOwn) }, _publisher.Changes);
    }

    [Fact]
    public async Task NothingCopied_NotifiesNobody()
    {
        _copyStore.Result = new CopyCollectionItemsResult(0, 3, 0);

        await Service().CopyAsync(Recipient, Shared, [5, 6, 7], RecipientOwn, null);

        Assert.Empty(_publisher.Events);
        Assert.Empty(_publisher.Changes);
    }

    [Fact]
    public async Task TheSourcesOwner_MayCopyOthersLinks_IntoTheirOwn_WithTheirOwnLinksRefusedByTheStore()
    {
        _accessStore.Add(30, Owner);

        await Service().CopyAsync(Owner, Shared, [5], 30, null);

        Assert.Equal([5L], _copyStore.LastIds);
        Assert.True(_copyStore.LastRejectCallerOwned);
    }

    [Fact]
    public async Task AParticipant_KeepsTheirOwnLinksReusable()
    {
        await Service().CopyAsync(Recipient, Shared, [5], RecipientOwn, null);

        Assert.False(_copyStore.LastRejectCallerOwned);
    }

    [Fact]
    public async Task OnlyIntoMyOwn_AndOnlyFromWhatICanSee()
    {
        // The source's Owner still copies only into a Collection of their own.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().CopyAsync(Owner, Shared, [5], RecipientOwn, null));
        // A destination the caller only participates in (or cannot see) is not theirs.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().CopyAsync(Recipient, Shared, [5], ProtectedShared, "share:11:u2:4"));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().CopyAsync(3, Shared, [5], RecipientOwn, null));
        Assert.Null(_copyStore.LastIds);
    }

    [Fact]
    public async Task EachSide_KeepsItsOwnContentGate()
    {
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Service().CopyAsync(Recipient, ProtectedShared, [5], RecipientOwn, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().CopyAsync(Recipient, Shared, [5], RecipientOwnLocked, null));
        Assert.Null(_copyStore.LastIds);

        var grants = string.Join(',',
            FakeUnlockTokenProtector.Token(ProtectedShared, CollectionUnlockSubject.ForUser(Recipient), 4, CollectionUnlockPurpose.SharePassword),
            FakeUnlockTokenProtector.Token(RecipientOwnLocked, CollectionUnlockSubject.ForUser(Recipient), 2));
        await Service().CopyAsync(Recipient, ProtectedShared, [5], RecipientOwnLocked, grants);
        Assert.Equal([5L], _copyStore.LastIds);
    }

    [Fact]
    public async Task TheRequest_IsBounded()
    {
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().CopyAsync(Recipient, Shared, [], RecipientOwn, null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().CopyAsync(Recipient, Shared, null, RecipientOwn, null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().CopyAsync(Recipient, Shared, [5], Shared, null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().CopyAsync(
            Recipient, Shared, Enumerable.Range(1, CopyCollectionItemsService.MaxItemsPerCopy + 1).Select(id => (long)id).ToList(), RecipientOwn, null));

        // Exactly the limit is fine.
        await Service().CopyAsync(
            Recipient, Shared, Enumerable.Range(1, CopyCollectionItemsService.MaxItemsPerCopy).Select(id => (long)id).ToList(), RecipientOwn, null);
        Assert.Equal(CopyCollectionItemsService.MaxItemsPerCopy, _copyStore.LastIds!.Count);
    }

    private sealed class RecordingCopyStore : ICollectionItemCopyStore
    {
        public IReadOnlyList<long>? LastIds { get; private set; }

        public bool LastRejectCallerOwned { get; private set; }

        public CopyCollectionItemsResult Result { get; set; } = new(1, 0, 0);

        public Task<CopyCollectionItemsResult> CopyAsync(
            long userId, long sourceCollectionId, IReadOnlyList<long> itemIds, long destinationCollectionId, DateTimeOffset nowUtc,
            bool rejectCallerOwnedItems = false, CancellationToken cancellationToken = default)
        {
            LastIds = itemIds;
            LastRejectCallerOwned = rejectCallerOwnedItems;
            return Task.FromResult(Result);
        }
    }
}
