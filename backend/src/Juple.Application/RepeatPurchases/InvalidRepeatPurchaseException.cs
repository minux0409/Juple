namespace Juple.Application.RepeatPurchases;

public sealed class InvalidRepeatPurchaseException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
