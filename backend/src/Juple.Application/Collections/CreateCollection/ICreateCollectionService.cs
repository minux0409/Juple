namespace Juple.Application.Collections.CreateCollection;

public interface ICreateCollectionService
{
    Task<CollectionDto> CreateAsync(
        long userId,
        CreateCollectionCommand command,
        CancellationToken cancellationToken = default);
}
