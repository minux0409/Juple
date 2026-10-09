using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.ShareLink;

namespace Juple.UnitTests.Collections;

/// <summary>
/// 친구에게 / ID로 공유 of a public link: for anyone who may view the Collection, to at most
/// MaxRecipientsPerShare people (normalized, de-duplicated, never oneself), unknown IDs reported
/// back - and the "is the link still on" decision is the store's, at the moment of sending.
/// </summary>
public sealed class ShareCollectionLinkServiceTests
{
    private const long Owner = 1;
    private const long Member = 2;
    private const long Stranger = 3;
    private const long Shared = 10;

    private readonly InMemoryCollectionAccessStore _accessStore = new();
    private readonly RecordingStore _store = new();
    private readonly Directory _directory = new();

    public ShareCollectionLinkServiceTests()
    {
        _accessStore.Add(Shared, Owner, Member);
        _directory.Users["AAAA2345"] = 20;
        _directory.Users["BBBB2345"] = 21;
        _directory.Users["MEEE2345"] = Member;
    }

    private ShareCollectionLinkService Service() =>
        new(new CollectionAccessService(_accessStore, new FakeUnlockTokenProtector(), TimeProvider.System), _directory, _store, TimeProvider.System);

    [Fact]
    public async Task AMember_SendsTo_EachPersonOnce_SkippingThemselves_AndReportsUnknownIds()
    {
        var result = await Service().ShareAsync(Member, Shared, ["aaaa-2345", "AAAA2345", "BBBB2345", "MEEE2345", "ZZZZ2345", "not an id"]);

        Assert.Equal(["AAAA2345", "BBBB2345"], result.Sent);
        Assert.Equal(["not an id", "ZZZZ2345"], result.NotFound.Order());
        Assert.Equal([20L, 21L], _store.LastRecipients);
        Assert.Equal((Member, Shared), _store.LastCall);
    }

    [Fact]
    public async Task TheOwner_MayAlsoSend()
    {
        await Service().ShareAsync(Owner, Shared, ["AAAA2345"]);

        Assert.Equal([20L], _store.LastRecipients);
    }

    [Fact]
    public async Task NobodyResolvable_RecordsNothing()
    {
        var result = await Service().ShareAsync(Member, Shared, ["ZZZZ2345", "MEEE2345"]);

        Assert.Empty(result.Sent);
        Assert.Null(_store.LastRecipients);
    }

    [Fact]
    public async Task SomeoneWhoCannotViewTheCollection_SendsNothing()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().ShareAsync(Stranger, Shared, ["AAAA2345"]));
        Assert.Null(_store.LastRecipients);
    }

    [Fact]
    public async Task TheRequest_IsBounded()
    {
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().ShareAsync(Member, Shared, []));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().ShareAsync(Member, Shared, null));
        var tooMany = Enumerable.Range(0, ShareCollectionLinkService.MaxRecipientsPerShare + 1).Select(index => $"x{index}").ToList();
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().ShareAsync(Member, Shared, tooMany));
        Assert.Null(_store.LastRecipients);

        // Duplicates do not count against the limit.
        var duplicates = Enumerable.Repeat("AAAA2345", ShareCollectionLinkService.MaxRecipientsPerShare + 5).ToList();
        await Service().ShareAsync(Member, Shared, duplicates);
        Assert.Equal([20L], _store.LastRecipients);
    }

    [Fact]
    public async Task ThePrivateOrPublicLink_IsNeverSentToSomeoneWhoAlreadyBelongs_TheServerDecides()
    {
        // 20 is already a member / the Owner / holds an invitation (the store knows, under its lock); 21 is a plain friend.
        _store.AlreadyInside.Add(20);

        var result = await Service().ShareAsync(Member, Shared, ["AAAA2345", "BBBB2345"]);

        Assert.Equal(["BBBB2345"], result.Sent);
        Assert.Equal(["AAAA2345"], result.Skipped);
        Assert.Empty(result.NotFound);
        Assert.Equal([21L], _store.LastRecipients);
    }

    [Fact]
    public async Task ALinkTurnedOff_FailsTheWholeSend()
    {
        _store.Inactive = true;

        var conflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Service().ShareAsync(Member, Shared, ["AAAA2345"]));
        Assert.Equal(CollectionCollaborationConflictException.PublicLinkInactive, conflict.Code);
    }

    private sealed class RecordingStore : ICollectionLinkShareStore
    {
        public bool Inactive { get; set; }

        public IReadOnlyCollection<long>? LastRecipients { get; private set; }

        public (long Sender, long Collection)? LastCall { get; private set; }

        public HashSet<long> AlreadyInside { get; } = [];

        public Task<IReadOnlyCollection<long>> EnqueueAsync(long senderUserId, long collectionId, IReadOnlyCollection<long> recipientUserIds, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            if (Inactive)
            {
                throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicLinkInactive);
            }

            LastRecipients = recipientUserIds.Where(id => !AlreadyInside.Contains(id)).ToList();
            LastCall = (senderUserId, collectionId);
            return Task.FromResult<IReadOnlyCollection<long>>(recipientUserIds.Where(AlreadyInside.Contains).ToList());
        }
    }

    private sealed class Directory : IUserDirectoryStore
    {
        public Dictionary<string, long> Users { get; } = new(StringComparer.Ordinal);

        public Task<long?> FindUserIdByPublicCodeAsync(string publicCode, CancellationToken cancellationToken = default) =>
            Task.FromResult(Users.TryGetValue(publicCode, out var id) ? id : (long?)null);

        public Task<string?> GetPublicCodeAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(null);
    }
}
