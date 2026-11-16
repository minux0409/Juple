namespace Juple.Application.Collections.UndoMergeCollections;

public interface IUndoMergeCollectionsService
{
    Task UndoAsync(long userId, Guid undoOperationId, CancellationToken cancellationToken = default);
}
