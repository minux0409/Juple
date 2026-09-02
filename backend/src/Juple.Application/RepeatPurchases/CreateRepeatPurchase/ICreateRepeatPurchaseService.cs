namespace Juple.Application.RepeatPurchases.CreateRepeatPurchase;

public interface ICreateRepeatPurchaseService
{
    Task<RepeatPurchaseDto> CreateAsync(
        long userId, CreateRepeatPurchaseCommand command, CancellationToken cancellationToken = default);
}
