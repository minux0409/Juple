namespace Juple.Application.Collections.CreateCollection;

public sealed class CreateCollectionService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : ICreateCollectionService
{
    public Task<CollectionDto> CreateAsync(
        long userId,
        CreateCollectionCommand command,
        CancellationToken cancellationToken = default)
    {
        var (name, nameNormalized) = CollectionNameNormalizer.Normalize(command.Name);
        var icon = CollectionIconParser.Parse(command.Icon);
        return collectionStore.CreateAsync(
            userId, name, nameNormalized, icon, timeProvider.GetUtcNow(), cancellationToken);
    }
}
