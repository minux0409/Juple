namespace Juple.Application.Purchases;

public sealed class InvalidPurchaseException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
