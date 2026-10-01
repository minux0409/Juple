using System.Security.Cryptography;
using System.Text;

namespace Juple.Domain.Collections;

/// <summary>
/// 승인 후 추가: a link someone proposed for a Collection, waiting for its Owner. Deliberately not a
/// CollectionItem - nothing about it is part of the Collection (no list, count, copy, move, remove or
/// notification) until the Owner approves it, which turns it into an ordinary CollectionItem of the
/// proposer's own Item and deletes this row; rejecting just deletes it. No status column and no
/// history: a row exists exactly while the proposal waits.
///
/// ItemId is the proposer's own Item (adding always starts by saving the link to one's own library,
/// as with every other add) - so an approved link belongs to its proposer exactly as a direct add
/// would. Url/Title/PreviewImageUrl are what the proposer's Item showed when proposing (the shared
/// fields only - never its memo or photos), for the Owner to review. UrlHash (SHA-256 of Url) makes
/// "one pending proposal per link per Collection" a database rule - Url itself is too long to index.
/// </summary>
public sealed class CollectionLinkSubmission
{
    private CollectionLinkSubmission()
    {
    }

    public CollectionLinkSubmission(
        long collectionId,
        long itemId,
        long submittedByUserId,
        bool viaPublicShare,
        string url,
        string? title,
        string? previewImageUrl,
        DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        SubmittedByUserId = submittedByUserId;
        ViaPublicShare = viaPublicShare;
        Url = url;
        UrlHash = HashOf(url);
        Title = title;
        PreviewImageUrl = previewImageUrl;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    public long SubmittedByUserId { get; private set; }

    /// <summary>Proposed through the public link by someone who is not a member - then never named to anyone.</summary>
    public bool ViaPublicShare { get; private set; }

    public string Url { get; private set; } = null!;

    public byte[] UrlHash { get; private set; } = null!;

    public string? Title { get; private set; }

    public string? PreviewImageUrl { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>The same link is the same exact URL (as saving stores it) - the rule copying uses too.</summary>
    public static byte[] HashOf(string url) => SHA256.HashData(Encoding.UTF8.GetBytes(url));
}
