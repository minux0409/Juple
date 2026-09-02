namespace Juple.Application.RepeatPurchases.LogPurchase;

public interface ILogPurchaseService
{
    /// <summary>expectedVersion is the RowVersion the client last read - see IRepeatPurchaseStore.UpdateAsync's identical contract.</summary>
    Task<LogPurchaseResult> LogAsync(
        long userId,
        long repeatPurchaseId,
        LogPurchaseCommand command,
        byte[] expectedVersion,
        CancellationToken cancellationToken = default);
}
