using Juple.Application.Friends;
using Juple.Domain.Friends;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Friends;

public sealed class FriendStore(JupleDbContext dbContext) : IFriendStore
{
    public async Task<FriendRequestDto> CreateRequestAsync(
        long requesterUserId,
        long recipientUserId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var low = Math.Min(requesterUserId, recipientUserId);
        var high = Math.Max(requesterUserId, recipientUserId);
        var existing = await dbContext.Friendships
            .AsNoTracking()
            .FirstOrDefaultAsync(friendship => friendship.UserLowId == low && friendship.UserHighId == high, cancellationToken);
        if (existing is not null)
        {
            throw new FriendRequestConflictException(ConflictCodeFor(existing, requesterUserId));
        }

        var created = Friendship.Request(requesterUserId, recipientUserId, nowUtc);
        dbContext.Friendships.Add(created);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // Both sides requested at the same moment - answer with whatever now exists.
            dbContext.ChangeTracker.Clear();
            var winner = await dbContext.Friendships.AsNoTracking()
                .FirstAsync(friendship => friendship.UserLowId == low && friendship.UserHighId == high, cancellationToken);
            throw new FriendRequestConflictException(ConflictCodeFor(winner, requesterUserId));
        }

        var recipient = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == recipientUserId)
            .Select(user => new { user.PublicCode, user.DisplayName })
            .FirstAsync(cancellationToken);
        return new FriendRequestDto(created.Id, recipient.PublicCode, recipient.DisplayName, FriendRequestDirections.Outgoing, created.CreatedAtUtc);
    }

    private static string ConflictCodeFor(Friendship existing, long requesterUserId) =>
        existing.Status == FriendshipStatus.Accepted
            ? FriendRequestConflictException.AlreadyFriends
            : existing.RequestedByUserId == requesterUserId
                ? FriendRequestConflictException.RequestPending
                : FriendRequestConflictException.IncomingRequestExists;

    public async Task<IReadOnlyList<FriendRequestDto>> ListRequestsAsync(long userId, int limit, CancellationToken cancellationToken = default)
    {
        var rows = await (
            from friendship in dbContext.Friendships.AsNoTracking()
            where friendship.Status == FriendshipStatus.Pending
                && (friendship.UserLowId == userId || friendship.UserHighId == userId)
            join other in dbContext.Users.AsNoTracking()
                on (friendship.UserLowId == userId ? friendship.UserHighId : friendship.UserLowId) equals other.Id
            orderby friendship.CreatedAtUtc descending, friendship.Id descending
            select new { friendship.Id, friendship.RequestedByUserId, friendship.CreatedAtUtc, other.PublicCode, other.DisplayName })
            .Take(limit)
            .ToListAsync(cancellationToken);

        return rows.Select(row => new FriendRequestDto(
                row.Id,
                row.PublicCode,
                row.DisplayName,
                row.RequestedByUserId == userId ? FriendRequestDirections.Outgoing : FriendRequestDirections.Incoming,
                row.CreatedAtUtc))
            .ToList();
    }

    public async Task<FriendDto> AcceptAsync(long userId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var friendship = await dbContext.Friendships.FirstOrDefaultAsync(entry => entry.Id == requestId, cancellationToken);
        if (friendship is null || !friendship.Involves(userId))
        {
            throw new FriendNotFoundException();
        }

        if (friendship.Status == FriendshipStatus.Pending)
        {
            if (!friendship.IsIncomingRequestFor(userId))
            {
                // Only the recipient answers a request - the requester can only cancel it.
                throw new FriendNotFoundException();
            }

            friendship.Accept(nowUtc);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Cancelled/declined concurrently.
                throw new FriendNotFoundException();
            }
        }

        // Accepting an already-accepted friendship is an idempotent replay.
        return await GetFriendAsync(userId, friendship.Id, cancellationToken) ?? throw new FriendNotFoundException();
    }

    public async Task DeleteRequestAsync(long userId, long requestId, bool asRecipient, CancellationToken cancellationToken = default)
    {
        var deleted = await dbContext.Friendships
            .Where(friendship => friendship.Id == requestId
                && friendship.Status == FriendshipStatus.Pending
                && (friendship.UserLowId == userId || friendship.UserHighId == userId)
                && (asRecipient ? friendship.RequestedByUserId != userId : friendship.RequestedByUserId == userId))
            .ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0)
        {
            throw new FriendNotFoundException();
        }
    }

    public async Task RemoveFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken = default)
    {
        // Notes cascade with the friendship. Collection collaborations are a separate relationship
        // and are deliberately not touched.
        var deleted = await dbContext.Friendships
            .Where(friendship => friendship.Id == friendshipId
                && friendship.Status == FriendshipStatus.Accepted
                && (friendship.UserLowId == userId || friendship.UserHighId == userId))
            .ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0)
        {
            throw new FriendNotFoundException();
        }
    }

    public async Task<FriendDto> SetNoteAsync(long userId, long friendshipId, string? note, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var isMyFriendship = await dbContext.Friendships.AnyAsync(
            friendship => friendship.Id == friendshipId
                && friendship.Status == FriendshipStatus.Accepted
                && (friendship.UserLowId == userId || friendship.UserHighId == userId),
            cancellationToken);
        if (!isMyFriendship)
        {
            throw new FriendNotFoundException();
        }

        var existing = await dbContext.FriendshipNotes
            .FirstOrDefaultAsync(entry => entry.FriendshipId == friendshipId && entry.UserId == userId, cancellationToken);
        if (note is null)
        {
            if (existing is not null)
            {
                dbContext.FriendshipNotes.Remove(existing);
            }
        }
        else if (existing is null)
        {
            dbContext.FriendshipNotes.Add(new FriendshipNote(friendshipId, userId, note, nowUtc));
        }
        else
        {
            existing.Update(note, nowUtc);
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent first save of the same note - retry once as an update.
            dbContext.ChangeTracker.Clear();
            var saved = await dbContext.FriendshipNotes.FirstAsync(entry => entry.FriendshipId == friendshipId && entry.UserId == userId, cancellationToken);
            saved.Update(note!, nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return await GetFriendAsync(userId, friendshipId, cancellationToken) ?? throw new FriendNotFoundException();
    }

    public async Task<FriendPage> ListFriendsAsync(long userId, string? query, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var rows = FriendRows(userId);
        if (query is not null)
        {
            // Juple IDs are stored canonical (no separator, uppercase) - accept "k7mp-4q8n" too.
            var codeQuery = query.Replace("-", string.Empty).Replace(" ", string.Empty).ToUpperInvariant();
            rows = rows.Where(row =>
                (row.DisplayName != null && row.DisplayName.Contains(query))
                || (codeQuery.Length > 0 && row.PublicCode.Contains(codeQuery))
                || (row.MyNote != null && row.MyNote.Contains(query)));
        }

        if (cursor is { } afterId)
        {
            rows = rows.Where(row => row.FriendshipId < afterId);
        }

        var page = await rows
            .OrderByDescending(row => row.FriendshipId)
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var items = (hasMore ? page.GetRange(0, limit) : page).Select(ToDto).ToList();
        return new FriendPage(items, hasMore ? items[^1].FriendshipId : null);
    }

    private async Task<FriendDto?> GetFriendAsync(long userId, long friendshipId, CancellationToken cancellationToken)
    {
        var row = await FriendRows(userId).FirstOrDefaultAsync(entry => entry.FriendshipId == friendshipId, cancellationToken);
        return row is null ? null : ToDto(row);
    }

    /// <summary>
    /// The caller's accepted friends in one statement: the other user's public identity and the
    /// caller's OWN note (the note join is keyed by the caller's UserId, so the friend's note about
    /// the caller can never come back through here).
    /// </summary>
    private IQueryable<FriendRow> FriendRows(long userId) =>
        from friendship in dbContext.Friendships.AsNoTracking()
        where friendship.Status == FriendshipStatus.Accepted
            && (friendship.UserLowId == userId || friendship.UserHighId == userId)
        join other in dbContext.Users.AsNoTracking()
            on (friendship.UserLowId == userId ? friendship.UserHighId : friendship.UserLowId) equals other.Id
        select new FriendRow
        {
            FriendshipId = friendship.Id,
            PublicCode = other.PublicCode,
            DisplayName = other.DisplayName,
            MyNote = dbContext.FriendshipNotes
                .Where(note => note.FriendshipId == friendship.Id && note.UserId == userId)
                .Select(note => note.Note)
                .FirstOrDefault(),
            FriendsSinceUtc = friendship.AcceptedAtUtc ?? friendship.CreatedAtUtc,
        };

    private static FriendDto ToDto(FriendRow row) =>
        new(row.FriendshipId, row.PublicCode, row.DisplayName, row.MyNote, row.FriendsSinceUtc);

    private sealed class FriendRow
    {
        public long FriendshipId { get; init; }

        public string PublicCode { get; init; } = null!;

        public string? DisplayName { get; init; }

        public string? MyNote { get; init; }

        public DateTimeOffset FriendsSinceUtc { get; init; }
    }
}
