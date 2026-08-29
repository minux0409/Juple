namespace Juple.Application.Inbox;

public sealed class InvalidInboxRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}