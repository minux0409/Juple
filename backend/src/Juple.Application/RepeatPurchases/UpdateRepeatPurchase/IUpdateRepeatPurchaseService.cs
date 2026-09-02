namespace Juple.Application.RepeatPurchases.UpdateRepeatPurchase;

public interface IUpdateRepeatPurchaseService
{
    /// <summary>expectedVersion is the RowVersion the client last read - see IRepeatPurchaseStore.UpdateAsync.</summary>
    Task<RepeatPurchaseDto> UpdateAsync(
        long userId,
        long repeatPurchaseId,
        UpdateRepeatPurchaseCommand command,
        byte[] expectedVersion,
        CancellationToken cancellationToken = default);
}
