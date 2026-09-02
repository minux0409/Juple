namespace Juple.Application.RepeatPurchases.UpdateRepeatPurchase;

public sealed class UpdateRepeatPurchaseService(
    IRepeatPurchaseStore repeatPurchaseStore,
    TimeProvider timeProvider) : IUpdateRepeatPurchaseService
{
    public Task<RepeatPurchaseDto> UpdateAsync(
        long userId,
        long repeatPurchaseId,
        UpdateRepeatPurchaseCommand command,
        byte[] expectedVersion,
        CancellationToken cancellationToken = default)
    {
        var fields = RepeatPurchaseFieldsNormalizer.Normalize(
            command.ItemId,
            command.ProductName,
            command.IntervalValue,
            command.IntervalUnit,
            command.NextPurchaseDate,
            command.IsReminderEnabled,
            command.ReminderLeadDays);

        return repeatPurchaseStore.UpdateAsync(
            userId, repeatPurchaseId, fields, expectedVersion, timeProvider.GetUtcNow(), cancellationToken);
    }
}
