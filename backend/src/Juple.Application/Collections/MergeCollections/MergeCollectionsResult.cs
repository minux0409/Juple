namespace Juple.Application.Collections.MergeCollections;

/// <summary>
/// UndoOperationId is null only for the source-equals-target no-op (see
/// CollectionStore.MergeAsync) - nothing was merged or deleted, so there is nothing to undo.
/// AddedToTargetCount: memberships this merge actually created in the target (links it already had
/// are not counted) - drives the one grouped new-link notification; never part of the API response.
/// </summary>
public sealed record MergeCollectionsResult(Guid? UndoOperationId, int AddedToTargetCount = 0);
