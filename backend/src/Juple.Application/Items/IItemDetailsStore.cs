namespace Juple.Application.Items;

public interface IItemDetailsStore
{
    /// <summary>
    /// Replaces the caller's Item's Title/Memo. Callers must pass already-normalized values.
    /// </summary>
    Task UpdateDetailsAsync(
        long userId,
        long itemId,
        string? title,
        string? memo,
        CancellationToken cancellationToken = default);
}
