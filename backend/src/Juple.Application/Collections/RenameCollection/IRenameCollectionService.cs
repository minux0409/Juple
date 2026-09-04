namespace Juple.Application.Collections.RenameCollection;

public interface IRenameCollectionService
{
    Task RenameAsync(
        long userId,
        long collectionId,
        RenameCollectionCommand command,
        CancellationToken cancellationToken = default);
}
