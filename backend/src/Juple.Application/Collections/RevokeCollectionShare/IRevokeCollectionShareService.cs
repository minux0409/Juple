namespace Juple.Application.Collections.RevokeCollectionShare;

public interface IRevokeCollectionShareService
{
    Task RevokeAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
