using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Domain.Collections;
using Juple.Domain.Friends;
using Juple.Domain.Safety;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Friends;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Friends;

/// <summary>
/// "함께 공유 중인 컬렉션": only Collections both people take part in as Owner or member - never a public link, a removed member, someone
/// else's friend, or across a block - in the caller's own list shape, through the same stores production wires.
/// </summary>
public sealed class FriendSharedCollectionsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _me;
    private long _friend;
    private long _third;
    private long _stranger;
    private long _friendshipWithFriend;
    private long _friendshipWithThird;
    private CollectionStore _collections = null!;
    private CollectionCollaborationService _collaboration = null!;
    private FriendSharedCollectionsService _service = null!;
    private long _mineSharedWithFriend;
    private long _withThirdOnly;
    private long _theirsSharedWithMe;
    private long _thirdsWithBoth;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _me = await NewUserAsync();
        _friend = await NewUserAsync();
        _third = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _service = new FriendSharedCollectionsService(new FriendStore(_db), _collections, new DbBlockPolicy(_db));

        _friendshipWithFriend = await FriendsAsync(_me, _friend);
        _friendshipWithThird = await FriendsAsync(_me, _third);

        var now = DateTimeOffset.UtcNow;
        _mineSharedWithFriend = (await _collections.CreateAsync(_me, "With friend", "WITH FRIEND", CollectionIcon.Folder, now.AddSeconds(-5))).Id;
        _withThirdOnly = (await _collections.CreateAsync(_me, "With third only", "WITH THIRD ONLY", CollectionIcon.Folder, now.AddSeconds(-4))).Id;
        await _collections.CreateAsync(_me, "Private", "PRIVATE", CollectionIcon.Folder, now.AddSeconds(-3));
        _theirsSharedWithMe = (await _collections.CreateAsync(_friend, "Friend own", "FRIEND OWN", CollectionIcon.Folder, now.AddSeconds(-2))).Id;
        _thirdsWithBoth = (await _collections.CreateAsync(_third, "Third own", "THIRD OWN", CollectionIcon.Folder, now.AddSeconds(-1))).Id;

        await AcceptAsync(_me, _mineSharedWithFriend, _friend);
        await AcceptAsync(_me, _withThirdOnly, _third);
        await AcceptAsync(_friend, _theirsSharedWithMe, _me);
        await AcceptAsync(_third, _thirdsWithBoth, _me);
        await AcceptAsync(_third, _thirdsWithBoth, _friend);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private async Task<IReadOnlyList<long>> IdsAsync(long userId, long friendshipId) =>
        (await _service.ListAsync(userId, friendshipId, null, 50)).Items.Select(c => c.Id).OrderBy(id => id).ToList();

    [Fact]
    public async Task ListsOnlyCollectionsBothTakePartIn_OwnedMemberAndThirdParty()
    {
        var ids = await IdsAsync(_me, _friendshipWithFriend);

        Assert.Equal(new[] { _mineSharedWithFriend, _theirsSharedWithMe, _thirdsWithBoth }.OrderBy(id => id), ids);
        var page = await _service.ListAsync(_me, _friendshipWithFriend, null, 50);
        // The caller's own role per row - the same list shape as their Collections.
        Assert.Equal("owner", page.Items.Single(c => c.Id == _mineSharedWithFriend).AccessRole);
        Assert.Equal("contributor", page.Items.Single(c => c.Id == _theirsSharedWithMe).AccessRole);
    }

    [Fact]
    public async Task APublicLinkAloneSharesNothing_AndARemovedMemberDisappears()
    {
        var linkOnly = (await _collections.CreateAsync(_friend, "Link only", "LINK ONLY", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        Assert.DoesNotContain(linkOnly, await IdsAsync(_me, _friendshipWithFriend));

        await _collaboration.RemoveCollaboratorAsync(_friend, _theirsSharedWithMe, await JupleIdOfAsync(_me));
        _db.ChangeTracker.Clear();
        Assert.DoesNotContain(_theirsSharedWithMe, await IdsAsync(_me, _friendshipWithFriend));
    }

    [Fact]
    public async Task EachFriendSeesOnlyTheirOwnShared_AndAnotherUsersFriendshipIsNotFound()
    {
        Assert.Equal(new[] { _withThirdOnly, _thirdsWithBoth }.OrderBy(id => id), await IdsAsync(_me, _friendshipWithThird));
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _service.ListAsync(_stranger, _friendshipWithFriend, null, 50));
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _service.ListAsync(_me, 987654321, null, 50));
    }

    [Fact]
    public async Task ABlockInEitherDirection_AnswersAnEmptyList()
    {
        _db.UserBlocks.Add(new UserBlock(_friend, _me, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Empty(await IdsAsync(_me, _friendshipWithFriend));
    }

    [Fact]
    public async Task ABlockByTheCaller_AnswersAnEmptyList_TooAndTheFriendshipRowIsUntouched()
    {
        _db.UserBlocks.Add(new UserBlock(_me, _friend, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Empty(await IdsAsync(_me, _friendshipWithFriend));
        // The other friend is not affected by a block of someone else.
        Assert.NotEmpty(await IdsAsync(_me, _friendshipWithThird));
    }

    [Fact]
    public async Task ADeletedCollectionAndARemovedFriendshipDisappear()
    {
        await _collections.DeleteAsync(_me, _mineSharedWithFriend);
        _db.ChangeTracker.Clear();
        Assert.DoesNotContain(_mineSharedWithFriend, await IdsAsync(_me, _friendshipWithFriend));

        var friendship = await _db.Friendships.SingleAsync(row => row.Id == _friendshipWithFriend);
        _db.Friendships.Remove(friendship);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _service.ListAsync(_me, _friendshipWithFriend, null, 50));
    }

    [Fact]
    public async Task PagingFollowsTheCursor_NoRowTwice_AndATamperedCursorCannotWidenTheScope()
    {
        var first = await _service.ListAsync(_me, _friendshipWithFriend, null, 2);
        Assert.Equal(2, first.Items.Count);
        Assert.NotNull(first.NextCursor);

        var second = await _service.ListAsync(_me, _friendshipWithFriend, first.NextCursor, 2);
        Assert.Single(second.Items);
        Assert.Null(second.NextCursor);
        Assert.Equal(
            new[] { _mineSharedWithFriend, _theirsSharedWithMe, _thirdsWithBoth }.OrderBy(id => id),
            first.Items.Concat(second.Items).Select(c => c.Id).OrderBy(id => id));

        // A cursor is only a position inside the already-restricted result: an arbitrary one (far in the future, any id) still returns
        // nothing outside the shared set - e.g. never the caller's private Collection.
        var wild = await _service.ListAsync(_me, _friendshipWithFriend, new CollectionPageCursor(DateTimeOffset.UtcNow.AddYears(50), long.MaxValue), 50);
        Assert.All(wild.Items, c => Assert.Contains(c.Id, new[] { _mineSharedWithFriend, _theirsSharedWithMe, _thirdsWithBoth }));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(101, false)]
    [InlineData(100, true)]
    [InlineData(1, true)]
    public void TheLimitIsBounded(int limit, bool accepted)
    {
        Assert.Equal(accepted, CollectionsQueryParameters.TryParseLimit(limit, out _));
        Assert.False(CollectionPageCursorCodec.TryDecode("not-a-cursor", out _));
    }

    private async Task AcceptAsync(long ownerId, long collectionId, long inviteeId)
    {
        var invitation = await _collaboration.InviteAsync(ownerId, collectionId, await JupleIdOfAsync(inviteeId));
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
    }

    private async Task<long> FriendsAsync(long a, long b)
    {
        var friendship = Friendship.Request(a, b, DateTimeOffset.UtcNow);
        friendship.Accept(DateTimeOffset.UtcNow);
        _db.Friendships.Add(friendship);
        await _db.SaveChangesAsync();
        return friendship.Id;
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    /// <summary>The block rule straight from the table: a row in either direction.</summary>
    private sealed class DbBlockPolicy(JupleDbContext db) : Juple.Application.Safety.IUserBlockPolicy
    {
        public Task<bool> AreBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default) =>
            db.UserBlocks.AsNoTracking().AnyAsync(
                block => (block.BlockerUserId == userId && block.BlockedUserId == otherUserId) || (block.BlockerUserId == otherUserId && block.BlockedUserId == userId),
                cancellationToken);

        public Task EnsureNotBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<IReadOnlySet<long>> BlockedByAsync(long viewerUserId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlySet<long>>(new HashSet<long>());
    }
}
