namespace Juple.Application.Collections.SetCollectionColor;

public interface ISetCollectionColorService
{
    Task<CollectionDto> SetColorAsync(
        long userId,
        long collectionId,
        SetCollectionColorCommand command,
        CancellationToken cancellationToken = default);
}
