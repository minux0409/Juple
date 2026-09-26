namespace Juple.Application.Items.EmptyItemTrash;

public interface IEmptyItemTrashService
{
    /// <summary>Permanently deletes every one of the caller's trashed Items - the whole server-side trash, not just what the capped list UI shows.</summary>
    Task EmptyAsync(long userId, CancellationToken cancellationToken = default);
}
