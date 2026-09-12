namespace Juple.Application.UrlMetadata;

public sealed class InvalidUrlMetadataRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
