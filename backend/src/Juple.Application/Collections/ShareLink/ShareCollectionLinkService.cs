using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Domain.Users;

namespace Juple.Application.Collections.ShareLink;

/// <param name="Sent">Recipients who were sent the link (by Juple ID, as normalized).</param>
/// <param name="NotFound">Requested Juple IDs that are malformed or belong to nobody - nothing was sent to them.</param>
/// <param name="Skipped">Recipients who already belong to the Collection (its Owner, a member) or hold a pending invitation to it - the link is pointless for them, so nothing was sent (not an error).</param>
public sealed record ShareCollectionLinkResult(IReadOnlyList<string> Sent, IReadOnlyList<string> NotFound, IReadOnlyList<string>? Skipped = null);

/// <summary>Records the passed-on link for each recipient - in one transaction with the "still public" check.</summary>
public interface ICollectionLinkShareStore
{
    /// <summary>
    /// Inside one transaction under the Collection's row lock: confirms the Collection still has an active link
    /// (public or private - CollectionCollaborationConflictException PublicLinkInactive otherwise, and nothing is
    /// recorded for anyone), drops every recipient who already belongs to the Collection or has a pending invitation
    /// (decided here, under the lock - a stale picker can never send the link to them), then records one
    /// CollectionLinkShared notification per remaining recipient. Only ids are stored (sender, Collection) - never the
    /// link itself, a password or a token. Returns the user ids that were skipped.
    /// </summary>
    Task<IReadOnlyCollection<long>> EnqueueAsync(
        long senderUserId,
        long collectionId,
        IReadOnlyCollection<long> recipientUserIds,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);
}

public interface IShareCollectionLinkService
{
    Task<ShareCollectionLinkResult> ShareAsync(
        long userId,
        long collectionId,
        IReadOnlyCollection<string>? jupleIds,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// 친구에게 / ID로 공유 of a Collection's canonical link: anyone who may view the Collection (the Owner or
/// an accepted member) passes the Owner's link on to other Juple users, as a Juple notification that opens
/// the same share resolver as any /c/{publicId} link (a member goes to the Collection, a nonmember to the public
/// view or - when the Collection is private - to the participation preview). It is never a membership: nobody is
/// invited, added or given a role. The link must exist at the moment of sending, and recipients who already belong
/// to the Collection (or hold a pending invitation) are skipped - both decided by the server, not trusted from the app.
/// </summary>
public sealed class ShareCollectionLinkService(
    ICollectionAccessService accessService,
    IUserDirectoryStore userDirectory,
    ICollectionLinkShareStore linkShareStore,
    TimeProvider timeProvider) : IShareCollectionLinkService
{
    /// <summary>
    /// Recipients per send. One request carries the whole choice (friends and Juple IDs alike); the
    /// endpoint's per-identity rate limit (the same as invitations) bounds how often.
    /// </summary>
    public const int MaxRecipientsPerShare = 20;

    public async Task<ShareCollectionLinkResult> ShareAsync(
        long userId,
        long collectionId,
        IReadOnlyCollection<string>? jupleIds,
        CancellationToken cancellationToken = default)
    {
        var requested = (jupleIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).ToList();
        if (requested.Count == 0)
        {
            throw new InvalidCollectionException("jupleIds", "Choose at least one person.");
        }

        // Normalized and de-duplicated first, so "abcd-2345" and "ABCD2345" are one person.
        var normalized = new List<string>();
        var notFound = new List<string>();
        foreach (var raw in requested)
        {
            if (UserPublicCode.TryNormalize(raw, out var code))
            {
                if (!normalized.Contains(code, StringComparer.Ordinal))
                {
                    normalized.Add(code);
                }
            }
            else if (!notFound.Contains(raw, StringComparer.Ordinal))
            {
                notFound.Add(raw);
            }
        }

        if (normalized.Count + notFound.Count > MaxRecipientsPerShare)
        {
            throw new InvalidCollectionException("jupleIds", $"At most {MaxRecipientsPerShare} people at once.");
        }

        await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);

        var recipients = new List<long>();
        var sent = new List<string>();
        var byId = new Dictionary<long, string>();
        foreach (var code in normalized)
        {
            var recipient = await userDirectory.FindUserIdByPublicCodeAsync(code, cancellationToken);
            if (recipient is null)
            {
                notFound.Add(code);
            }
            else if (recipient != userId)
            {
                // Sending it to oneself is simply skipped - neither sent nor an error.
                recipients.Add(recipient.Value);
                sent.Add(code);
                byId[recipient.Value] = code;
            }
        }

        var skipped = new List<string>();
        if (recipients.Count > 0)
        {
            var skippedIds = await linkShareStore.EnqueueAsync(userId, collectionId, recipients, timeProvider.GetUtcNow(), cancellationToken);
            foreach (var skippedId in skippedIds)
            {
                if (byId.TryGetValue(skippedId, out var code))
                {
                    sent.Remove(code);
                    skipped.Add(code);
                }
            }
        }

        return new ShareCollectionLinkResult(sent, notFound, skipped);
    }
}
