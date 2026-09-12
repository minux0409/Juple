namespace Juple.Application.UrlMetadata.ResolveUrlMetadata;

public interface IResolveUrlMetadataService
{
    Task<UrlMetadataResult> ResolveAsync(
        ResolveUrlMetadataCommand command,
        CancellationToken cancellationToken = default);
}
