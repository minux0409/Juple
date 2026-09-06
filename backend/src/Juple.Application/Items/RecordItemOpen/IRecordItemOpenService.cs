namespace Juple.Application.Items.RecordItemOpen;

public interface IRecordItemOpenService
{
    /// <summary>Throws <see cref="ItemNotFoundException"/> if itemId does not exist or is not owned by userId.</summary>
    Task RecordAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
