namespace Juple.Application.Collections.RenameCollection;

public sealed class RenameCollectionService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider,
    Juple.Application.Safety.ISharedContentReviewFlagger? reviewFlagger = null) : IRenameCollectionService
{
    public async Task RenameAsync(
        long userId,
        long collectionId,
        RenameCollectionCommand command,
        CancellationToken cancellationToken = default)
    {
        var (name, nameNormalized) = CollectionNameNormalizer.Normalize(command.Name);
        await collectionStore.RenameAsync(
            userId, collectionId, name, nameNormalized, timeProvider.GetUtcNow(), cancellationToken);
        if (reviewFlagger is not null)
        {
            await reviewFlagger.FlagCollectionNameAsync(collectionId, cancellationToken);
        }
    }
}
