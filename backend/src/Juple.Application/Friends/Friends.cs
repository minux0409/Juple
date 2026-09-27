using Juple.Application.Collections.Collaboration;
using Juple.Application.Notifications;
using Juple.Domain.Friends;
using Juple.Domain.Users;

namespace Juple.Application.Friends;

/// <summary>
/// An accepted friend as the caller sees them: public Juple ID, the friend's chosen display name,
/// and the caller's OWN private note (never the friend's note about the caller). Never an internal
/// id, email or identity-provider id.
/// </summary>
public sealed record FriendDto(long FriendshipId, string JupleId, string? DisplayName, string? MyNote, DateTimeOffset FriendsSinceUtc);

/// <summary>A pending request involving the caller. Direction is "incoming" (to answer) or "outgoing" (to cancel).</summary>
public sealed record FriendRequestDto(long RequestId, string JupleId, string? DisplayName, string Direction, DateTimeOffset CreatedAtUtc);

public static class FriendRequestDirections
{
    public const string Incoming = "incoming";
    public const string Outgoing = "outgoing";
}

public sealed record FriendPage(IReadOnlyList<FriendDto> Items, long? NextCursor);

/// <summary>No such friendship/request for this caller (also for anyone else's) - 404, never a hint that it exists.</summary>
public sealed class FriendNotFoundException : Exception;

/// <summary>409 with a stable code: alreadyFriends, requestPending, incomingRequestExists.</summary>
public sealed class FriendRequestConflictException(string code) : Exception(code)
{
    public const string AlreadyFriends = "alreadyFriends";
    public const string RequestPending = "requestPending";
    public const string IncomingRequestExists = "incomingRequestExists";

    public string Code { get; } = code;
}

/// <summary>400 - a request to oneself, or an invalid note.</summary>
public sealed class InvalidFriendRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

public interface IFriendStore
{
    /// <summary>
    /// Creates a pending request, or throws FriendRequestConflictException when the pair already has
    /// a row (accepted → alreadyFriends; pending from the caller → requestPending; pending from the
    /// other person → incomingRequestExists - that one is answered, never duplicated).
    /// </summary>
    Task<FriendRequestDto> CreateRequestAsync(long requesterUserId, long recipientUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<FriendRequestDto>> ListRequestsAsync(long userId, int limit, CancellationToken cancellationToken = default);

    /// <summary>Accepts a pending request addressed to userId; anything else is FriendNotFoundException.</summary>
    Task<FriendDto> AcceptAsync(long userId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Deletes a pending request the caller received (decline) or sent (cancel) - never an accepted friendship.</summary>
    Task DeleteRequestAsync(long userId, long requestId, bool asRecipient, CancellationToken cancellationToken = default);

    /// <summary>Deletes an accepted friendship involving userId, with both private notes. Collaborations are untouched.</summary>
    Task RemoveFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken = default);

    /// <summary>Sets (null clears) the caller's own note on an accepted friendship involving them.</summary>
    Task<FriendDto> SetNoteAsync(long userId, long friendshipId, string? note, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// The caller's accepted friends, newest friendship first, optionally filtered by a search over
    /// the friend's display name, Juple ID and the caller's own note - only ever within the caller's
    /// own friends, never a directory search. Cursor: the last FriendshipId of the previous page.
    /// </summary>
    Task<FriendPage> ListFriendsAsync(long userId, string? query, long? cursor, int limit, CancellationToken cancellationToken = default);
}

public interface IFriendService
{
    Task<FriendRequestDto> SendRequestAsync(long userId, string? jupleId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<FriendRequestDto>> ListRequestsAsync(long userId, CancellationToken cancellationToken = default);

    Task<FriendDto> AcceptAsync(long userId, long requestId, CancellationToken cancellationToken = default);

    Task DeclineAsync(long userId, long requestId, CancellationToken cancellationToken = default);

    Task CancelAsync(long userId, long requestId, CancellationToken cancellationToken = default);

    Task RemoveFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken = default);

    Task<FriendDto> SetNoteAsync(long userId, long friendshipId, string? note, CancellationToken cancellationToken = default);

    Task<FriendPage> ListFriendsAsync(long userId, string? query, long? cursor, int limit, CancellationToken cancellationToken = default);
}

public sealed class FriendService(
    IUserDirectoryStore userDirectory,
    IFriendStore friendStore,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : IFriendService
{
    /// <summary>Pending requests are few by nature; a generous fixed cap instead of paging.</summary>
    public const int MaxRequestsListed = 200;

    public const int MaxSearchLength = 100;

    /// <summary>Exact Juple ID only (like Collection invitations) - never a search by display name.</summary>
    public async Task<FriendRequestDto> SendRequestAsync(long userId, string? jupleId, CancellationToken cancellationToken = default)
    {
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode)
            || await userDirectory.FindUserIdByPublicCodeAsync(publicCode, cancellationToken) is not { } targetUserId)
        {
            throw new JupleIdNotFoundException();
        }

        if (targetUserId == userId)
        {
            throw new InvalidFriendRequestException("jupleId", "You cannot send a friend request to yourself.");
        }

        var request = await friendStore.CreateRequestAsync(userId, targetUserId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null)
        {
            await notifications.FriendRequestReceivedAsync(userId, targetUserId, request.RequestId, cancellationToken);
        }

        return request;
    }

    public Task<IReadOnlyList<FriendRequestDto>> ListRequestsAsync(long userId, CancellationToken cancellationToken = default) =>
        friendStore.ListRequestsAsync(userId, MaxRequestsListed, cancellationToken);

    public Task<FriendDto> AcceptAsync(long userId, long requestId, CancellationToken cancellationToken = default) =>
        friendStore.AcceptAsync(userId, requestId, timeProvider.GetUtcNow(), cancellationToken);

    public Task DeclineAsync(long userId, long requestId, CancellationToken cancellationToken = default) =>
        friendStore.DeleteRequestAsync(userId, requestId, asRecipient: true, cancellationToken);

    public Task CancelAsync(long userId, long requestId, CancellationToken cancellationToken = default) =>
        friendStore.DeleteRequestAsync(userId, requestId, asRecipient: false, cancellationToken);

    public Task RemoveFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken = default) =>
        friendStore.RemoveFriendAsync(userId, friendshipId, cancellationToken);

    public Task<FriendDto> SetNoteAsync(long userId, long friendshipId, string? note, CancellationToken cancellationToken = default)
    {
        if (!FriendNoteText.TryNormalize(note, out var normalized, out var error))
        {
            throw new InvalidFriendRequestException("note", error!);
        }

        return friendStore.SetNoteAsync(userId, friendshipId, normalized, timeProvider.GetUtcNow(), cancellationToken);
    }

    public Task<FriendPage> ListFriendsAsync(long userId, string? query, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var trimmed = query?.Trim();
        if (trimmed is { Length: > MaxSearchLength })
        {
            trimmed = trimmed[..MaxSearchLength];
        }

        return friendStore.ListFriendsAsync(userId, string.IsNullOrEmpty(trimmed) ? null : trimmed, cursor, limit, cancellationToken);
    }
}
