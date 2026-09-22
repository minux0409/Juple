namespace Juple.Application.Collections.MergeCollections;

/// <summary>
/// UndoOperationId is null only for the source-equals-target no-op (see
/// CollectionStore.MergeAsync) - nothing was merged or deleted, so there is nothing to undo.
/// </summary>
public sealed record MergeCollectionsResult(Guid? UndoOperationId);
