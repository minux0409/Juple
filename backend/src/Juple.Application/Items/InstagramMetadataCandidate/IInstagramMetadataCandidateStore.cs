namespace Juple.Application.Items.InstagramMetadataCandidate;

public interface IInstagramMetadataCandidateStore
{
    /// <summary>The caller's own, non-trashed Item's saved URL - throws ItemNotFoundException otherwise (never reveals another user's Item).</summary>
    Task<string> GetActiveItemUrlAsync(long userId, long itemId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies already-normalized values with Item.ApplyAutomaticMetadata's fill-only-empty rule
    /// (re-read at write time, so a concurrent user edit or retry-Job success is never overwritten)
    /// and returns the Item's resulting state. A concurrency conflict is not an error: the other
    /// write wins and the current state is returned with Applied=false.
    /// </summary>
    Task<InstagramMetadataCandidateResult> ApplyAutomaticMetadataAsync(
        long userId,
        long itemId,
        NormalizedInstagramMetadata metadata,
        CancellationToken cancellationToken = default);
}
