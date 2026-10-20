using Azure;
using Azure.Storage.Blobs;
using Juple.Application.DataExport;

namespace Juple.Infrastructure.DataExport;

/// <summary>
/// Reads the person's own stored files (link photos, profile and Collection photos) for the export, straight from Blob Storage with the
/// API's managed identity - no SAS URL is created. Every name must be under the person's own <c>items/{userId}/</c> prefix: the
/// reader only ever passes names it selected by that person's ownership, and anything else is refused loudly.
/// </summary>
public sealed class DataExportBlobFileSource(BlobContainerClient container) : IDataExportFileSource
{
    public async Task<Stream?> OpenReadAsync(long userId, string blobName, CancellationToken cancellationToken = default)
    {
        if (!blobName.StartsWith($"items/{userId}/", StringComparison.Ordinal) || blobName.Contains("..", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Refusing to read a Blob outside the person's own storage prefix.");
        }

        try
        {
            return await container.GetBlobClient(blobName).OpenReadAsync(cancellationToken: cancellationToken);
        }
        catch (RequestFailedException exception) when (exception.Status == 404)
        {
            // Removed since it was listed (a photo replaced or deleted meanwhile): the manifest counts it as not found.
            return null;
        }
    }
}
