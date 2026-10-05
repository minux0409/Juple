using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Users.Profile;
using Juple.Domain.Notifications;

namespace Juple.Application.Notifications.Inbox;

/// <summary>
/// Which notifications make up a user's in-app Notification Inbox (알림): the visible social ones a
/// person would want to look back at. The data-only refresh signals (3, 4, 5) exist only to update an
/// open screen and never appear there, nor does the unused RepeatPurchaseDue (0). Nothing here changes
/// who is notified or what is pushed - the Inbox only reads the rows the pipeline already wrote.
/// </summary>
public static class NotificationInboxPolicy
{
    /// <summary>The Inbox Types - mirrored literally by the filtered indexes' predicate (see NotificationConfiguration).</summary>
    public static readonly NotificationType[] InboxTypes =
    [
        NotificationType.FriendRequestReceived,
        NotificationType.CollectionInvitationReceived,
        NotificationType.CollectionItemsAdded,
        NotificationType.CollectionLinkShared,
        NotificationType.CollectionItemReactionReceived,
        NotificationType.CollectionItemCommentReceived,
        NotificationType.CollectionLinkSubmissionReceived,
        NotificationType.CollectionLinkSubmissionApproved,
        NotificationType.CollectionLinkSubmissionRejected,
        NotificationType.FriendRequestAccepted,
        NotificationType.FriendRequestRejected,
    ];

    /// <summary>The same set as SQL - the filtered indexes' predicate must match it exactly.</summary>
    public const string InboxTypesSql = "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14)";

    public const int DefaultPageSize = 30;
    public const int MaxPageSize = 100;

    public static bool IsInboxType(NotificationType type) => Array.IndexOf(InboxTypes, type) >= 0;

    /// <summary>Only these name who caused them. A proposal and its result never do (nor does the row store anyone).</summary>
    public static bool ShowsActor(NotificationType type) =>
        type is NotificationType.FriendRequestReceived
            or NotificationType.FriendRequestAccepted
            or NotificationType.FriendRequestRejected
            or NotificationType.CollectionInvitationReceived
            or NotificationType.CollectionItemsAdded
            or NotificationType.CollectionLinkShared
            or NotificationType.CollectionItemReactionReceived
            or NotificationType.CollectionItemCommentReceived;

    /// <summary>These cannot be worded without the actor's name - with the actor gone, the row is unavailable.</summary>
    public static bool RequiresActor(NotificationType type) =>
        type is NotificationType.FriendRequestReceived
            or NotificationType.FriendRequestAccepted
            or NotificationType.FriendRequestRejected
            or NotificationType.CollectionInvitationReceived
            or NotificationType.CollectionLinkShared
            or NotificationType.CollectionItemReactionReceived
            or NotificationType.CollectionItemCommentReceived;

    /// <summary>
    /// Where tapping the notification leads, decided from the facts as they are now - never from what
    /// was true when it was recorded. Anything the recipient can no longer reach resolves to a less
    /// specific place they still can (the link → its Collection), and finally to Unavailable: the
    /// client then stays put and says so, and the row shows no name of anything.
    /// </summary>
    public static NotificationTargetDto ResolveTarget(NotificationInboxRecord record)
    {
        switch (record.Type)
        {
            case NotificationType.FriendRequestReceived:
                return record.Actor is null ? NotificationTargetDto.Unavailable : new NotificationTargetDto(NotificationTargetKinds.FriendRequests);

            case NotificationType.FriendRequestAccepted:
            case NotificationType.FriendRequestRejected:
                // The answer to the recipient's own request: the Friends screen (a new friend shows there).
                return record.Actor is null ? NotificationTargetDto.Unavailable : new NotificationTargetDto(NotificationTargetKinds.Friends);

            case NotificationType.CollectionInvitationReceived:
                if (record.InvitationPending && record.CollectionLive)
                {
                    return new NotificationTargetDto(NotificationTargetKinds.CollectionInvitations, CollectionId: record.CollectionId);
                }

                return record.RecipientBelongs ? Collection(record) : NotificationTargetDto.Unavailable;

            case NotificationType.CollectionItemsAdded:
                return record.RecipientBelongs ? Collection(record) : NotificationTargetDto.Unavailable;

            case NotificationType.CollectionLinkShared:
                return record.CollectionLive && record.PublicShareId is { } sharedPublicId
                    ? new NotificationTargetDto(NotificationTargetKinds.PublicCollection, PublicId: sharedPublicId)
                    : NotificationTargetDto.Unavailable;

            case NotificationType.CollectionItemReactionReceived:
            case NotificationType.CollectionItemCommentReceived:
                if (!record.RecipientBelongs)
                {
                    return NotificationTargetDto.Unavailable;
                }

                // The link itself while it is still the recipient's own link there; else its Collection.
                return record.LinkStillOwn && record.SubjectId is { } itemId
                    ? new NotificationTargetDto(
                        NotificationTargetKinds.CollectionItem,
                        CollectionId: record.CollectionId,
                        ItemId: itemId,
                        Focus: record.Type == NotificationType.CollectionItemCommentReceived ? NotificationTargetFocus.Comments : null)
                    : Collection(record);

            case NotificationType.CollectionLinkSubmissionReceived:
                // The 승인 대기 list - only for the Owner of a Collection that still exists.
                return record.CollectionLive && record.RecipientIsOwner
                    ? new NotificationTargetDto(NotificationTargetKinds.CollectionSubmissions, CollectionId: record.CollectionId)
                    : NotificationTargetDto.Unavailable;

            case NotificationType.CollectionLinkSubmissionApproved:
            case NotificationType.CollectionLinkSubmissionRejected:
                // Someone who belongs opens the Collection; someone who proposed through the public link
                // opens that link while it is on; otherwise there is nothing they may open.
                if (record.RecipientBelongs)
                {
                    return Collection(record);
                }

                return record.CollectionLive && record.PublicShareId is { } resultPublicId
                    ? new NotificationTargetDto(NotificationTargetKinds.PublicCollection, PublicId: resultPublicId)
                    : NotificationTargetDto.Unavailable;

            default:
                return NotificationTargetDto.Unavailable;
        }
    }

    private static NotificationTargetDto Collection(NotificationInboxRecord record) =>
        new(NotificationTargetKinds.Collection, CollectionId: record.CollectionId);
}

public static class NotificationTargetKinds
{
    public const string FriendRequests = "friendRequests";
    public const string Friends = "friends";
    public const string CollectionInvitations = "collectionInvitations";
    public const string Collection = "collection";
    public const string CollectionItem = "collectionItem";
    public const string CollectionSubmissions = "collectionSubmissions";
    public const string PublicCollection = "publicCollection";
    public const string Unavailable = "unavailable";
}

public static class NotificationTargetFocus
{
    public const string Comments = "comments";
}

/// <summary>
/// Where a notification leads. Ids are present only for what the recipient can open right now: a
/// Collection they own or belong to (CollectionId), their own link there (ItemId), or a public link
/// that is on (PublicId - never the internal Collection id for someone who is not a member).
/// </summary>
public sealed record NotificationTargetDto(
    string Kind,
    long? CollectionId = null,
    long? ItemId = null,
    string? PublicId = null,
    string? Focus = null)
{
    public static readonly NotificationTargetDto Unavailable = new(NotificationTargetKinds.Unavailable);
}

/// <summary>Who caused it, as anyone who can see them by nickname would: Juple ID, display name, photo - never an internal id.</summary>
public sealed record NotificationActorDto(string JupleId, string? DisplayName, string? ProfileImageUrl, string? ProfileImageVersion);

/// <summary>
/// One Inbox row. Title/Body are the same sentence the Push used (SocialPushText), in the requested
/// app language - null when the target is Unavailable, so a row about something the recipient can
/// no longer open never names it (the client shows its own generic line instead). Never carries a
/// comment's text, a memo, an email or a token.
/// PreviewImageUrl: the thumbnail of the RECIPIENT'S OWN link the row is about (a reaction/comment on it,
/// or the result of the proposal of it) - the link's already-stored preview image, set-based, never a
/// fetch per row; null for everything else (and for an Unavailable row).
/// CollectionImageUrl/Version: the Collection's icon photo, only where the recipient may see the
/// Collection by name (they belong to it) - the client falls back to its folder icon without one.
/// </summary>
public sealed record NotificationDto(
    long Id,
    string Type,
    string? Title,
    string? Body,
    NotificationActorDto? Actor,
    string? CollectionName,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ReadAtUtc,
    NotificationTargetDto Target,
    string? PreviewImageUrl = null,
    string? CollectionImageUrl = null,
    string? CollectionImageVersion = null);

public sealed record NotificationPageDto(IReadOnlyList<NotificationDto> Items, long? NextCursor, int UnreadCount);

/// <summary>After a read action: how many rows it marked and what is still unread (for the bell).</summary>
public sealed record NotificationReadResultDto(int MarkedCount, int UnreadCount);

public sealed record NotificationInboxActor(long UserId, string PublicCode, string? DisplayName, string? ProfileImageBlobName);

/// <summary>
/// A notification row plus the facts its target and wording depend on, all as they are now - loaded
/// for a whole page in a fixed number of set queries (see INotificationInboxStore).
/// </summary>
public sealed record NotificationInboxRecord(
    long Id,
    NotificationType Type,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ReadAtUtc,
    int? ItemCount,
    long? CollectionId,
    long? SubjectId,
    bool ActorHidden,
    NotificationInboxActor? Actor,
    string? CollectionName,
    bool CollectionLive,
    bool RecipientIsOwner,
    bool RecipientBelongs,
    string? PublicShareId,
    bool LinkStillOwn,
    bool InvitationPending,
    string? PreviewImageUrl = null,
    string? CollectionIconBlobName = null,
    long CollectionOwnerUserId = 0);

public interface INotificationInboxStore
{
    /// <summary>The recipient's Inbox rows newest first (by Id - identity, so monotonic), those older than beforeId, at most take.</summary>
    Task<IReadOnlyList<NotificationInboxRecord>> ListAsync(long userId, long? beforeId, int take, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>One of the recipient's own Inbox rows; null for anyone else's, a non-Inbox Type or a missing id.</summary>
    Task<NotificationInboxRecord?> GetAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<int> CountUnreadAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes one of the recipient's own Inbox rows (its Push delivery rows go with it - cascade). Idempotent
    /// in effect: false only when there is no such row of theirs (anyone else's id, a non-Inbox Type, gone).
    /// </summary>
    Task<bool> DeleteAsync(long userId, long notificationId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent. False only when it is not one of the recipient's own Inbox rows.</summary>
    Task<bool> MarkReadAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>One set-based update of every unread Inbox row of the recipient; returns how many it marked.</summary>
    Task<int> MarkAllReadAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>One set-based update of the recipient's unread rows of this Type about this Collection.</summary>
    Task<int> MarkCollectionReadAsync(long userId, long collectionId, NotificationType type, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public sealed class NotificationNotFoundException() : Exception("The notification was not found.");

public sealed class InvalidNotificationRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

public interface INotificationInboxService
{
    Task<NotificationPageDto> ListAsync(long userId, long? cursor, int? limit, string? locale, CancellationToken cancellationToken = default);

    /// <summary>Throws NotificationNotFoundException for anything but one of the caller's own Inbox rows.</summary>
    Task<NotificationDto> GetAsync(long userId, long notificationId, string? locale, CancellationToken cancellationToken = default);

    Task<int> CountUnreadAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent; throws NotificationNotFoundException for anything but one of the caller's own Inbox rows. No Push side effect.</summary>
    Task<NotificationReadResultDto> MarkReadAsync(long userId, long notificationId, CancellationToken cancellationToken = default);

    Task<NotificationReadResultDto> MarkAllReadAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes one of the caller's own Inbox rows and returns what is still unread (for the bell).
    /// NotificationNotFoundException for anything else - exactly like read.
    /// </summary>
    Task<NotificationReadResultDto> DeleteAsync(long userId, long notificationId, CancellationToken cancellationToken = default);

    /// <summary>Opening a Collection: its unread 새 링크 notifications are read. Its 승인 대기 count is a task, not a notification - untouched.</summary>
    Task<NotificationReadResultDto> MarkCollectionNewLinksReadAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Opening a Collection's 승인 대기 list: its approval-request notifications are read (the requests still wait).</summary>
    Task<NotificationReadResultDto> MarkCollectionSubmissionRequestsReadAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}

public sealed class NotificationInboxService(
    INotificationInboxStore store,
    TimeProvider timeProvider,
    IUserProfileImageStorage? profileImageStorage = null,
    ICollectionIconImageStorage? collectionIconStorage = null) : INotificationInboxService
{
    /// <summary>A locale tag as the app sends it ("ko", "pt-BR", "zh-Hans"); anything else falls back to English.</summary>
    private const int MaxLocaleLength = 35;

    public async Task<NotificationPageDto> ListAsync(long userId, long? cursor, int? limit, string? locale, CancellationToken cancellationToken = default)
    {
        var pageSize = limit ?? NotificationInboxPolicy.DefaultPageSize;
        if (pageSize is < 1 or > NotificationInboxPolicy.MaxPageSize)
        {
            throw new InvalidNotificationRequestException("limit", $"limit must be between 1 and {NotificationInboxPolicy.MaxPageSize}.");
        }

        if (cursor is <= 0)
        {
            throw new InvalidNotificationRequestException("cursor", "cursor is invalid.");
        }

        var records = await store.ListAsync(userId, cursor, pageSize + 1, timeProvider.GetUtcNow(), cancellationToken);
        var page = records.Count > pageSize ? records.Take(pageSize).ToList() : records;
        var items = await ToDtosAsync(page, locale, cancellationToken);
        var unread = await store.CountUnreadAsync(userId, cancellationToken);
        return new NotificationPageDto(items, records.Count > pageSize ? page[^1].Id : null, unread);
    }

    public async Task<NotificationDto> GetAsync(long userId, long notificationId, string? locale, CancellationToken cancellationToken = default)
    {
        var record = await store.GetAsync(userId, notificationId, timeProvider.GetUtcNow(), cancellationToken)
            ?? throw new NotificationNotFoundException();
        return (await ToDtosAsync([record], locale, cancellationToken))[0];
    }

    public Task<int> CountUnreadAsync(long userId, CancellationToken cancellationToken = default) =>
        store.CountUnreadAsync(userId, cancellationToken);

    public async Task<NotificationReadResultDto> MarkReadAsync(long userId, long notificationId, CancellationToken cancellationToken = default)
    {
        if (!await store.MarkReadAsync(userId, notificationId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new NotificationNotFoundException();
        }

        return new NotificationReadResultDto(1, await store.CountUnreadAsync(userId, cancellationToken));
    }

    public async Task<NotificationReadResultDto> DeleteAsync(long userId, long notificationId, CancellationToken cancellationToken = default)
    {
        if (!await store.DeleteAsync(userId, notificationId, cancellationToken))
        {
            throw new NotificationNotFoundException();
        }

        return new NotificationReadResultDto(0, await store.CountUnreadAsync(userId, cancellationToken));
    }

    public async Task<NotificationReadResultDto> MarkAllReadAsync(long userId, CancellationToken cancellationToken = default)
    {
        var marked = await store.MarkAllReadAsync(userId, timeProvider.GetUtcNow(), cancellationToken);
        return new NotificationReadResultDto(marked, await store.CountUnreadAsync(userId, cancellationToken));
    }

    public Task<NotificationReadResultDto> MarkCollectionNewLinksReadAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        MarkCollectionReadAsync(userId, collectionId, NotificationType.CollectionItemsAdded, cancellationToken);

    public Task<NotificationReadResultDto> MarkCollectionSubmissionRequestsReadAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        MarkCollectionReadAsync(userId, collectionId, NotificationType.CollectionLinkSubmissionReceived, cancellationToken);

    /// <summary>
    /// Only the caller's own rows are touched, so no access check is needed (and none would leak
    /// anything: the answer is about the caller's own notifications only).
    /// </summary>
    private async Task<NotificationReadResultDto> MarkCollectionReadAsync(long userId, long collectionId, NotificationType type, CancellationToken cancellationToken)
    {
        var marked = await store.MarkCollectionReadAsync(userId, collectionId, type, timeProvider.GetUtcNow(), cancellationToken);
        return new NotificationReadResultDto(marked, await store.CountUnreadAsync(userId, cancellationToken));
    }

    /// <summary>Each distinct actor's photo is signed once per page (local signing - no extra query), never once per row.</summary>
    private async Task<IReadOnlyList<NotificationDto>> ToDtosAsync(
        IReadOnlyList<NotificationInboxRecord> records, string? locale, CancellationToken cancellationToken)
    {
        var language = NormalizeLocale(locale);
        var targets = records.ToDictionary(record => record.Id, NotificationInboxPolicy.ResolveTarget);
        var shownActors = records
            .Where(record => IsShownWithActor(record, targets[record.Id]))
            .Select(record => record.Actor!)
            .DistinctBy(actor => actor.UserId)
            .ToList();
        var actorDtos = new Dictionary<long, NotificationActorDto>(shownActors.Count);
        foreach (var actor in shownActors)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(actor.UserId, actor.ProfileImageBlobName, cancellationToken);
            actorDtos[actor.UserId] = new NotificationActorDto(actor.PublicCode, actor.DisplayName, image.Url, image.Version);
        }

        // One signing step per distinct Collection photo on the page (local signing - no query, no per-row work).
        var collectionImages = new Dictionary<string, (string Url, string Version)>(StringComparer.Ordinal);
        if (collectionIconStorage is not null)
        {
            foreach (var record in records.Where(record => record.CollectionIconBlobName is not null
                && targets[record.Id].Kind != NotificationTargetKinds.Unavailable
                && !collectionImages.ContainsKey(record.CollectionIconBlobName!)))
            {
                var url = await collectionIconStorage.CreateCollectionIconReadUrlAsync(
                    record.CollectionOwnerUserId, record.CollectionIconBlobName!, cancellationToken);
                if (url is not null)
                {
                    collectionImages[record.CollectionIconBlobName!] = (url.ToString(), CollectionIconImageVersion.From(record.CollectionIconBlobName!));
                }
            }
        }

        return records.Select(record =>
        {
            var target = targets[record.Id];
            var wireType = SocialNotificationPolicy.WireType(record.Type);
            if (target.Kind == NotificationTargetKinds.Unavailable
                || (NotificationInboxPolicy.RequiresActor(record.Type) && record.Actor is null))
            {
                return new NotificationDto(record.Id, wireType, null, null, null, null, record.CreatedAtUtc, record.ReadAtUtc, NotificationTargetDto.Unavailable);
            }

            var actor = IsShownWithActor(record, target) ? actorDtos[record.Actor!.UserId] : null;
            var actorName = actor is null ? string.Empty : ActorName(record.Actor!);
            var (title, body) = SocialPushText.For(
                record.Type, language, actorName, record.CollectionName ?? string.Empty,
                record.ItemCount ?? 1, viaPublicLink: record.ActorHidden);
            var collectionImage = record.CollectionIconBlobName is { } blobName && collectionImages.TryGetValue(blobName, out var signed)
                ? signed
                : ((string Url, string Version)?)null;
            return new NotificationDto(
                record.Id, wireType, title, body, actor, record.CollectionName, record.CreatedAtUtc, record.ReadAtUtc, target,
                record.PreviewImageUrl, collectionImage?.Url, collectionImage?.Version);
        }).ToList();
    }

    private static bool IsShownWithActor(NotificationInboxRecord record, NotificationTargetDto target) =>
        NotificationInboxPolicy.ShowsActor(record.Type)
            && !record.ActorHidden
            && record.Actor is not null
            && target.Kind != NotificationTargetKinds.Unavailable;

    /// <summary>The display name, else the Juple ID in the app's "ABCD-EFGH" form - exactly what the Push used.</summary>
    private static string ActorName(NotificationInboxActor actor) =>
        string.IsNullOrWhiteSpace(actor.DisplayName)
            ? actor.PublicCode.Length == 8 ? $"{actor.PublicCode[..4]}-{actor.PublicCode[4..]}" : actor.PublicCode
            : actor.DisplayName;

    private static string? NormalizeLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale) || locale.Length > MaxLocaleLength)
        {
            return null;
        }

        return locale.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_') ? locale : null;
    }
}
