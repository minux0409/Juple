namespace Juple.Application.Images;

public sealed class InvalidItemImageException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
