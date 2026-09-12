namespace Juple.Application.UrlSafety;

public sealed class InvalidUrlSafetyRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
