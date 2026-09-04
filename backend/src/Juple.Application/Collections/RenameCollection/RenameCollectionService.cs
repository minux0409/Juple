namespace Juple.Application.Collections.RenameCollection;

public sealed class RenameCollectionService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : IRenameCollectionService
{
    public Task RenameAsync(
        long userId,
        long collectionId,
        RenameCollectionCommand command,
        CancellationToken cancellationToken = default)
    {
        var (name, nameNormalized) = CollectionNameNormalizer.Normalize(command.Name);
        return collectionStore.RenameAsync(
            userId, collectionId, name, nameNormalized, timeProvider.GetUtcNow(), cancellationToken);
    }
}
