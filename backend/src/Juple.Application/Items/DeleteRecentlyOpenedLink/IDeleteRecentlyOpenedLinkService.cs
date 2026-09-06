namespace Juple.Application.Items.DeleteRecentlyOpenedLink;

public interface IDeleteRecentlyOpenedLinkService
{
    /// <summary>Idempotent - a missing/already-deleted/other-user's Item all succeed too.</summary>
    Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
