using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Domain.Friends;

namespace Juple.UnitTests.Users;

public sealed class FriendRulesTests
{
    private static string Repeat(string value, int count) => string.Concat(Enumerable.Repeat(value, count));

    [Fact]
    public void Friendship_IsStoredInCanonicalOrder_WhoeverAsked()
    {
        var request = Friendship.Request(requesterUserId: 9, recipientUserId: 4, DateTimeOffset.UtcNow);

        Assert.Equal((4L, 9L, 9L), (request.UserLowId, request.UserHighId, request.RequestedByUserId));
        Assert.True(request.IsIncomingRequestFor(4));
        Assert.False(request.IsIncomingRequestFor(9));
        Assert.Throws<ArgumentException>(() => Friendship.Request(5, 5, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void Note_AcceptsUpTo200Characters_AndEveryAcceptedValueFitsTheColumn()
    {
        Assert.True(FriendNoteText.TryNormalize("  회사 개발팀 김민수 ", out var note, out _));
        Assert.Equal("회사 개발팀 김민수", note);
        Assert.True(FriendNoteText.TryNormalize(Repeat("가", 200), out _, out _));
        Assert.False(FriendNoteText.TryNormalize(Repeat("가", 201), out _, out _));

        // 200 ZWJ family emoji are 1600 UTF-16 units - within 200 characters, beyond the column: refused here.
        var family = "\U0001F468‍\U0001F469‍\U0001F467";
        Assert.True(FriendNoteText.TryNormalize(Repeat(family, 125), out var familyNote, out _));
        Assert.True(familyNote!.Length <= FriendNoteText.MaxStorageLength);
        Assert.False(FriendNoteText.TryNormalize(Repeat(family, 126), out _, out _));
    }

    [Theory]
    [InlineData("two\nlines")]
    [InlineData("tab\there")]
    [InlineData("rtl\u202Eoverride")]
    public void Note_RejectsLineBreaksAndControlCharacters(string input) =>
        Assert.False(FriendNoteText.TryNormalize(input, out _, out _));

    [Fact]
    public void Note_EmptyClearsIt()
    {
        Assert.True(FriendNoteText.TryNormalize("   ", out var note, out _));
        Assert.Null(note);
    }

    [Fact]
    public async Task SendRequest_IsExactJupleIdOnly_AndNeverToYourself()
    {
        var store = new RecordingFriendStore();
        var service = new FriendService(new Directory(), store, TimeProvider.System);

        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => service.SendRequestAsync(1, "피카츄"));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => service.SendRequestAsync(1, "NOBODY22"));
        var self = await Assert.ThrowsAsync<InvalidFriendRequestException>(() => service.SendRequestAsync(1, "MEEE2345"));
        Assert.Equal("jupleId", self.Field);
        Assert.Null(store.LastRequest);

        await service.SendRequestAsync(1, "frnd-2345");
        Assert.Equal((1L, 2L), store.LastRequest);
    }

    [Fact]
    public async Task SetNote_RefusesInvalidInput_WithoutTouchingTheStore()
    {
        var store = new RecordingFriendStore();
        var service = new FriendService(new Directory(), store, TimeProvider.System);

        await Assert.ThrowsAsync<InvalidFriendRequestException>(() => service.SetNoteAsync(1, 5, "a\nb"));
        Assert.False(store.NoteWritten);
    }

    private sealed class Directory : IUserDirectoryStore
    {
        public Task<long?> FindUserIdByPublicCodeAsync(string publicCode, CancellationToken cancellationToken = default) =>
            Task.FromResult<long?>(publicCode switch { "MEEE2345" => 1, "FRND2345" => 2, _ => null });

        public Task<string?> GetPublicCodeAsync(long userId, CancellationToken cancellationToken = default) => Task.FromResult<string?>(null);
    }

    private sealed class RecordingFriendStore : IFriendStore
    {
        public (long From, long To)? LastRequest { get; private set; }

        public bool NoteWritten { get; private set; }

        public Task<FriendRequestDto> CreateRequestAsync(long requesterUserId, long recipientUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastRequest = (requesterUserId, recipientUserId);
            return Task.FromResult(new FriendRequestDto(1, "FRND2345", null, FriendRequestDirections.Outgoing, nowUtc));
        }

        public Task<FriendDto> SetNoteAsync(long userId, long friendshipId, string? note, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            NoteWritten = true;
            return Task.FromResult(new FriendDto(friendshipId, "FRND2345", null, note, nowUtc));
        }

        public Task<IReadOnlyList<FriendRequestDto>> ListRequestsAsync(long userId, int limit, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AcceptedFriendRequest> AcceptAsync(long userId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<long> DeleteRequestAsync(long userId, long requestId, bool asRecipient, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task RemoveFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<FriendPage> ListFriendsAsync(long userId, string? query, long? cursor, int limit, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
