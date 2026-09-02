namespace Juple.Application.RepeatPurchases.CreateRepeatPurchase;

public sealed class CreateRepeatPurchaseService(
    IRepeatPurchaseStore repeatPurchaseStore,
    TimeProvider timeProvider) : ICreateRepeatPurchaseService
{
    public Task<RepeatPurchaseDto> CreateAsync(
        long userId,
        CreateRepeatPurchaseCommand command,
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

        return repeatPurchaseStore.CreateAsync(userId, fields, timeProvider.GetUtcNow(), cancellationToken);
    }
}
