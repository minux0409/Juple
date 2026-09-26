namespace Juple.Application.Items.InstagramMetadataCandidate;

/// <summary>
/// Device-fetched Instagram metadata fallback: when the Backend's own fetch of an Instagram post got
/// Instagram's login redirect instead of the post (observed from Azure), the user's device - which
/// still receives the public post page - extracts the raw OpenGraph values and sends them here.
/// Everything about them is decided server-side: ownership (the caller's own active Item), identity
/// (the Item is an Instagram post/reel and og:url, when present, is that same post), the shared
/// title/image rules (see IInstagramMetadataCandidateNormalizer), and the automatic-metadata fill rule
/// shared with the retry Job (Item.ApplyAutomaticMetadata - never overwrites a user's title or an
/// already-applied value). Idempotent: resending the same candidate changes nothing.
/// </summary>
public sealed class ApplyInstagramMetadataCandidateService(
    IInstagramMetadataCandidateStore store,
    IInstagramMetadataCandidateNormalizer normalizer) : IApplyInstagramMetadataCandidateService
{
    // Bounds on the raw payload only (the title itself is capped further by the shared rules) -
    // generous for real OpenGraph values, small enough that a hostile client cannot push large blobs.
    internal const int MaxTitleLength = 2000;
    internal const int MaxDescriptionLength = 4000;
    internal const int MaxUrlLength = 4096;

    public async Task<InstagramMetadataCandidateResult> ApplyAsync(
        long userId,
        long itemId,
        InstagramMetadataCandidateCommand candidate,
        CancellationToken cancellationToken = default)
    {
        ValidateLength("ogTitle", candidate.OgTitle, MaxTitleLength);
        ValidateLength("ogDescription", candidate.OgDescription, MaxDescriptionLength);
        ValidateLength("ogImage", candidate.OgImage, MaxUrlLength);
        ValidateLength("ogUrl", candidate.OgUrl, MaxUrlLength);

        var itemUrl = await store.GetActiveItemUrlAsync(userId, itemId, cancellationToken);
        var normalized = normalizer.Normalize(itemUrl, candidate)
            ?? throw new InvalidItemDetailsException(
                "candidate", "The metadata candidate does not belong to this Instagram Item.");

        return await store.ApplyAutomaticMetadataAsync(userId, itemId, normalized, cancellationToken);
    }

    private static void ValidateLength(string field, string? value, int maxLength)
    {
        if (value is not null && value.Length > maxLength)
        {
            throw new InvalidItemDetailsException(field, $"{field} is too long.");
        }
    }
}
