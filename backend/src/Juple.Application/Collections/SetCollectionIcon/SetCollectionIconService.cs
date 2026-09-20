namespace Juple.Application.Collections.SetCollectionIcon;

public sealed class SetCollectionIconService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : ISetCollectionIconService
{
    public Task<CollectionDto> SetIconAsync(
        long userId,
        long collectionId,
        SetCollectionIconCommand command,
        CancellationToken cancellationToken = default)
    {
        var icon = CollectionIconParser.Parse(command.Icon);
        return collectionStore.SetIconAsync(userId, collectionId, icon, timeProvider.GetUtcNow(), cancellationToken);
    }
}
