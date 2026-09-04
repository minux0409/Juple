namespace Juple.Application.Collections;

public sealed class InvalidCollectionException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
