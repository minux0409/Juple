using System.Security.Cryptography;
using System.Text.Json;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Friends;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Friends;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Users;

/// <summary>
/// Friends against the real schema: exact-ID requests and their lifecycle, private notes, search
/// within one's own friends, account deletion - and that a friendship is entirely independent of
/// Collection collaboration (it grants nothing, and neither side's removal touches the other).
/// </summary>
public sealed class FriendsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _alice;
    private long _bob;
    private long _carol;
    private FriendService _friends = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionStore _collections = null!;
    private UserProfileService _profiles = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _alice = await NewUserAsync();
        _bob = await NewUserAsync();
        _carol = await NewUserAsync();

        var directory = new UserDirectoryStore(_db);
        _friends = new FriendService(directory, new FriendStore(_db), TimeProvider.System);
        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(access, directory, new CollectionCollaborationStore(_db), TimeProvider.System);
        _profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System);
        await _profiles.SetDisplayNameAsync(_bob, "피카츄");
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

    [Fact]
    public async Task Request_ByExactJupleId_ThenAccept_MakesBothFriends()
    {
        var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        Assert.Equal(FriendRequestDirections.Outgoing, request.Direction);
        Assert.Equal("피카츄", request.DisplayName);

        var bobsView = Assert.Single(await _friends.ListRequestsAsync(_bob));
        Assert.Equal(FriendRequestDirections.Incoming, bobsView.Direction);
        Assert.Empty((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items); // pending is not a friend yet

        // Only the recipient answers.
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.AcceptAsync(_alice, request.RequestId));
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.AcceptAsync(_carol, request.RequestId));
        await _friends.AcceptAsync(_bob, request.RequestId);

        Assert.Equal(await JupleIdOfAsync(_bob), Assert.Single((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items).JupleId);
        Assert.Equal(await JupleIdOfAsync(_alice), Assert.Single((await _friends.ListFriendsAsync(_bob, null, null, 50)).Items).JupleId);
    }

    [Fact]
    public async Task Duplicates_Self_AndTheReverseDirection_NeverCreateASecondRow()
    {
        await Assert.ThrowsAsync<InvalidFriendRequestException>(() => _friends.SendRequestAsync(_alice, JupleIdOfAsync(_alice).Result));

        await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        var again = await Assert.ThrowsAsync<FriendRequestConflictException>(() => _friends.SendRequestAsync(_alice, JupleIdOfAsync(_bob).Result));
        Assert.Equal(FriendRequestConflictException.RequestPending, again.Code);
        var reverse = await Assert.ThrowsAsync<FriendRequestConflictException>(() => _friends.SendRequestAsync(_bob, JupleIdOfAsync(_alice).Result));
        Assert.Equal(FriendRequestConflictException.IncomingRequestExists, reverse.Code);
        Assert.Equal(1, await PairRowsAsync(_alice, _bob));

        await _friends.AcceptAsync(_bob, Assert.Single(await _friends.ListRequestsAsync(_bob)).RequestId);
        var accepted = await Assert.ThrowsAsync<FriendRequestConflictException>(() => _friends.SendRequestAsync(_bob, JupleIdOfAsync(_alice).Result));
        Assert.Equal(FriendRequestConflictException.AlreadyFriends, accepted.Code);
    }

    [Fact]
    public async Task Decline_Cancel_AndRemove_AreOnlyForThePeopleInvolved()
    {
        var toBob = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.CancelAsync(_bob, toBob.RequestId)); // not the requester
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.DeclineAsync(_alice, toBob.RequestId)); // not the recipient
        await _friends.DeclineAsync(_bob, toBob.RequestId);
        Assert.Equal(0, await PairRowsAsync(_alice, _bob));

        var toCarol = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_carol));
        await _friends.CancelAsync(_alice, toCarol.RequestId);
        Assert.Equal(0, await PairRowsAsync(_alice, _carol));

        var friendship = await BefriendAsync(_alice, _bob);
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.RemoveFriendAsync(_carol, friendship));
        await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.SetNoteAsync(_carol, friendship, "snoop"));
        await _friends.RemoveFriendAsync(_bob, friendship);
        Assert.Equal(0, await PairRowsAsync(_alice, _bob));
    }

    [Fact]
    public async Task Cancel_RemovesTheRequestFromBothPendingLists()
    {
        var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        Assert.Single(await _friends.ListRequestsAsync(_alice));
        Assert.Single(await _friends.ListRequestsAsync(_bob));

        await _friends.CancelAsync(_alice, request.RequestId);

        Assert.Empty(await _friends.ListRequestsAsync(_alice));
        Assert.Empty(await _friends.ListRequestsAsync(_bob));
        Assert.Empty((await _friends.ListFriendsAsync(_bob, null, null, 50)).Items);
    }

    [Fact]
    public async Task StaleAcceptAfterCancel_IsRejectedAsNoLongerPending_AndCreatesNoFriendship()
    {
        var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        await _friends.CancelAsync(_alice, request.RequestId);

        var stale = await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.AcceptAsync(_bob, request.RequestId));

        Assert.Equal(FriendNotFoundException.RequestNoLongerPending, stale.Code);
        Assert.Equal(0, await PairRowsAsync(_alice, _bob));
        Assert.Empty((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items);
        Assert.Empty((await _friends.ListFriendsAsync(_bob, null, null, 50)).Items);
    }

    [Fact]
    public async Task StaleDeclineAfterCancel_IsRejectedAsNoLongerPending()
    {
        var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        await _friends.CancelAsync(_alice, request.RequestId);

        var stale = await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.DeclineAsync(_bob, request.RequestId));

        Assert.Equal(FriendNotFoundException.RequestNoLongerPending, stale.Code);
    }

    [Fact]
    public async Task StaleCancelAfterAccept_DoesNotUndoTheFriendship()
    {
        var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        await _friends.AcceptAsync(_bob, request.RequestId);

        var stale = await Assert.ThrowsAsync<FriendNotFoundException>(() => _friends.CancelAsync(_alice, request.RequestId));

        Assert.Equal(FriendNotFoundException.RequestNoLongerPending, stale.Code);
        Assert.Equal(1, await PairRowsAsync(_alice, _bob));
        Assert.Single((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items);
    }

    [Fact]
    public async Task CancelAndAccept_Racing_LetExactlyOneTerminalActionWin()
    {
        for (var round = 0; round < 8; round++)
        {
            var request = await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
            await using var cancelDb = NewContext();
            await using var acceptDb = NewContext();
            var cancelService = new FriendService(new UserDirectoryStore(cancelDb), new FriendStore(cancelDb), TimeProvider.System);
            var acceptService = new FriendService(new UserDirectoryStore(acceptDb), new FriendStore(acceptDb), TimeProvider.System);

            var cancel = Capture(() => cancelService.CancelAsync(_alice, request.RequestId));
            var accept = Capture(() => acceptService.AcceptAsync(_bob, request.RequestId));
            var outcomes = await Task.WhenAll(cancel, accept);

            // Exactly one of the two won; the loser got the "no longer pending" answer.
            Assert.Equal(1, outcomes.Count(outcome => outcome is null));
            Assert.All(outcomes.Where(outcome => outcome is not null), outcome =>
                Assert.Equal(FriendNotFoundException.RequestNoLongerPending, Assert.IsType<FriendNotFoundException>(outcome).Code));
            var rows = await PairRowsAsync(_alice, _bob);
            if (outcomes[0] is null)
            {
                Assert.Equal(0, rows); // cancel won: no friendship
            }
            else
            {
                Assert.Equal(1, rows); // accept won: they are friends, the cancel changed nothing
                Assert.Single((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items);
                await _friends.RemoveFriendAsync(_alice, (await _friends.ListFriendsAsync(_alice, null, null, 50)).Items[0].FriendshipId);
            }

            _db.ChangeTracker.Clear();
        }
    }

    [Fact]
    public async Task Cancel_RemovesTheRecipientsInboxNotificationOfThatRequest()
    {
        var publisher = new Juple.Infrastructure.Notifications.SocialNotificationPublisher(
            _db, TimeProvider.System, Microsoft.Extensions.Logging.Abstractions.NullLogger<Juple.Infrastructure.Notifications.SocialNotificationPublisher>.Instance);
        var friends = new FriendService(new UserDirectoryStore(_db), new FriendStore(_db), TimeProvider.System, publisher);
        var request = await friends.SendRequestAsync(_alice, await JupleIdOfAsync(_bob));
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        Assert.True(await _db.Notifications.AnyAsync(entry => entry.UserId == _bob && entry.SubjectId == request.RequestId));

        await friends.CancelAsync(_alice, request.RequestId);

        Assert.False(await _db.Notifications.AnyAsync(entry => entry.UserId == _bob && entry.SubjectId == request.RequestId));
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")).Options);

    private static async Task<Exception?> Capture(Func<Task> action)
    {
        try
        {
            await action();
            return null;
        }
        catch (Exception exception)
        {
            return exception;
        }
    }

    [Fact]
    public async Task PrivateNotes_AreSeenOnlyByTheirAuthor_AndGoWithTheFriendship()
    {
        var friendship = await BefriendAsync(_alice, _bob);
        Assert.Equal("회사 개발팀 김민수", (await _friends.SetNoteAsync(_alice, friendship, "  회사 개발팀 김민수 ")).MyNote);
        Assert.Equal("대학 동기", (await _friends.SetNoteAsync(_alice, friendship, "대학 동기")).MyNote);

        Assert.Null(Assert.Single((await _friends.ListFriendsAsync(_bob, null, null, 50)).Items).MyNote);
        Assert.Empty((await _friends.ListFriendsAsync(_bob, "대학", null, 50)).Items); // Bob can't even search by it

        await _friends.RemoveFriendAsync(_alice, friendship);
        Assert.False(await _db.FriendshipNotes.AnyAsync(note => note.FriendshipId == friendship));
    }

    [Fact]
    public async Task Search_CoversNameJupleIdAndMyNote_WithinAcceptedFriendsOnly()
    {
        var friendship = await BefriendAsync(_alice, _bob);
        await _friends.SetNoteAsync(_alice, friendship, "회사 개발팀");
        await _friends.SendRequestAsync(_alice, await JupleIdOfAsync(_carol)); // pending: never listed

        var bobCode = await JupleIdOfAsync(_bob);
        foreach (var query in new[] { "피카", bobCode.ToLowerInvariant()[..4], $"{bobCode[..4]}-{bobCode[4..]}", "개발팀" })
        {
            Assert.Equal(friendship, Assert.Single((await _friends.ListFriendsAsync(_alice, query, null, 50)).Items).FriendshipId);
        }

        Assert.Empty((await _friends.ListFriendsAsync(_alice, await JupleIdOfAsync(_carol), null, 50)).Items);
        Assert.Empty((await _friends.ListFriendsAsync(_alice, "없는이름", null, 50)).Items);
    }

    [Fact]
    public async Task Friendship_GrantsNothing_AndIsIndependentOfCollaboration_BothWays()
    {
        var friendship = await BefriendAsync(_alice, _bob);
        await _friends.SetNoteAsync(_alice, friendship, "비밀 메모");
        var collectionId = (await _collections.CreateAsync(_alice, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        // Friends, but not a member: no access at all.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_bob, collectionId));

        // Collaboration still goes through the normal invitation.
        var invitation = await _collaboration.InviteAsync(_alice, collectionId, await JupleIdOfAsync(_bob));
        await _collaboration.AcceptInvitationAsync(_bob, invitation.InvitationId);

        // The note never appears in any collaboration-facing DTO.
        var exposed = JsonSerializer.Serialize(new object[]
        {
            await _collections.GetAsync(_bob, collectionId),
            await _collections.GetAsync(_alice, collectionId),
            await _collaboration.GetParticipantsAsync(_alice, collectionId),
            await _collaboration.GetParticipantsAsync(_bob, collectionId),
            await _collaboration.GetOverviewAsync(_alice, collectionId),
            await _collaboration.LookupAsync(_bob, await JupleIdOfAsync(_alice)),
        });
        Assert.DoesNotContain("비밀 메모", exposed);

        // Unfriending keeps the collaboration...
        await _friends.RemoveFriendAsync(_alice, friendship);
        Assert.Equal(CollectionDtoAccessRoles.Contributor, (await _collections.GetAsync(_bob, collectionId)).AccessRole);

        // ...and removing the collaborator keeps a (new) friendship.
        var again = await BefriendAsync(_bob, _alice);
        await _collaboration.RemoveCollaboratorAsync(_alice, collectionId, await JupleIdOfAsync(_bob));
        Assert.Equal(again, Assert.Single((await _friends.ListFriendsAsync(_alice, null, null, 50)).Items).FriendshipId);
    }

    [Fact]
    public async Task AccountDeletion_ClearsAllOfThatUsersFriendships_AndNotes_WithoutTouchingOthers()
    {
        var withBob = await BefriendAsync(_alice, _bob);
        await _friends.SetNoteAsync(_bob, withBob, "앨리스");
        await _friends.SendRequestAsync(_carol, await JupleIdOfAsync(_alice)); // pending too
        var bobAndCarol = await BefriendAsync(_bob, _carol);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_alice, $"test/{_alice}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_alice);

        Assert.False(await _db.Friendships.AnyAsync(friendship => friendship.UserLowId == _alice || friendship.UserHighId == _alice));
        Assert.False(await _db.FriendshipNotes.AnyAsync(note => note.FriendshipId == withBob));
        Assert.Equal(bobAndCarol, Assert.Single((await _friends.ListFriendsAsync(_bob, null, null, 50)).Items).FriendshipId);
        Assert.True(await _db.Users.AnyAsync(user => user.Id == _bob));
    }

    private async Task<long> BefriendAsync(long requester, long recipient)
    {
        var request = await _friends.SendRequestAsync(requester, await JupleIdOfAsync(recipient));
        return (await _friends.AcceptAsync(recipient, request.RequestId)).FriendshipId;
    }

    private Task<int> PairRowsAsync(long a, long b) =>
        _db.Friendships.CountAsync(friendship => friendship.UserLowId == Math.Min(a, b) && friendship.UserHighId == Math.Max(a, b));

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
}
