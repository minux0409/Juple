namespace Juple.Application.Collections.SetCollectionColor;

public sealed class SetCollectionColorService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : ISetCollectionColorService
{
    public Task<CollectionDto> SetColorAsync(
        long userId,
        long collectionId,
        SetCollectionColorCommand command,
        CancellationToken cancellationToken = default)
    {
        var color = CollectionColorParser.Parse(command.Color);
        return collectionStore.SetColorAsync(userId, collectionId, color, timeProvider.GetUtcNow(), cancellationToken);
    }
}
