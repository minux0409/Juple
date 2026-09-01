using Azure.Identity;
using Azure.Storage.Blobs;
using Microsoft.Extensions.Configuration;

namespace Juple.Infrastructure.Storage;

/// <summary>
/// Chooses how to authenticate to Blob Storage from configuration alone, so callers (and tests)
/// never branch on environment: ConnectionStrings:BlobStorage (Azurite locally, or a Storage
/// Account connection string) wins if present; otherwise BlobStorage:ServiceUri + Managed Identity
/// (DefaultAzureCredential) is used, which is the intended Production path - no Storage Account
/// key is ever read from configuration for Production.
/// </summary>
public static class BlobServiceClientFactory
{
    public static BlobServiceClient Create(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("BlobStorage");
        if (!string.IsNullOrWhiteSpace(connectionString))
        {
            return new BlobServiceClient(connectionString);
        }

        var serviceUri = configuration["BlobStorage:ServiceUri"];
        if (!string.IsNullOrWhiteSpace(serviceUri))
        {
            return new BlobServiceClient(new Uri(serviceUri), new DefaultAzureCredential());
        }

        throw new InvalidOperationException(
            "Either ConnectionStrings:BlobStorage or BlobStorage:ServiceUri must be configured " +
            "to create a BlobServiceClient.");
    }
}
