using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Domain.Users;

namespace Juple.Application.Collections.ShareLink;

/// <param name="Sent">Recipients who were sent the link (by Juple ID, as normalized).</param>
/// <param name="NotFound">Requested Juple IDs that are malformed or belong to nobody - nothing was sent to them.</param>
public sealed record ShareCollectionLinkResult(IReadOnlyList<string> Sent, IReadOnlyList<string> NotFound);

/// <summary>Records the passed-on link for each recipient - in one transaction with the "still public" check.</summary>
public interface ICollectionLinkShareStore
{
    /// <summary>
    /// Inside one transaction under the Collection's row lock: confirms the Collection still has its
    /// public link on (CollectionCollaborationConflictException PublicLinkInactive otherwise - and
    /// nothing is recorded for anyone), then records one CollectionLinkShared notification per
    /// recipient. Only ids are stored (sender, Collection) - never the link itself, a password or a token.
    /// </summary>
    Task EnqueueAsync(
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
/// 친구에게 / ID로 공유 of a Collection's public link: anyone who may view the Collection (the Owner or
/// an accepted member) passes the link the Owner already made public on to other Juple users, as a
/// Juple notification that opens the public link page. It is never a membership: nobody is invited,
/// added or given a role, and the recipient still meets the link's own password gate. The public
/// link must be on at the moment of sending - checked by the server, not trusted from the app.
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
            }
        }

        if (recipients.Count > 0)
        {
            await linkShareStore.EnqueueAsync(userId, collectionId, recipients, timeProvider.GetUtcNow(), cancellationToken);
        }

        return new ShareCollectionLinkResult(sent, notFound);
    }
}
