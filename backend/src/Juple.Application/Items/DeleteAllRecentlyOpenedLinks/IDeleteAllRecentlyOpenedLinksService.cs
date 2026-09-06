namespace Juple.Application.Items.DeleteAllRecentlyOpenedLinks;

public interface IDeleteAllRecentlyOpenedLinksService
{
    /// <summary>Idempotent - already having none succeeds too. Only ever clears the current user's own rows.</summary>
    Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default);
}
