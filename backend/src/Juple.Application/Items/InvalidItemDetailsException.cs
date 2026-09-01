namespace Juple.Application.Items;

public sealed class InvalidItemDetailsException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
