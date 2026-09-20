namespace Juple.Application.Collections.SetCollectionIcon;

public interface ISetCollectionIconService
{
    Task<CollectionDto> SetIconAsync(
        long userId,
        long collectionId,
        SetCollectionIconCommand command,
        CancellationToken cancellationToken = default);
}
