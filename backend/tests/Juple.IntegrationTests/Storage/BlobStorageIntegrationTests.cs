using System.Text;
using Azure.Storage.Blobs.Models;
using Juple.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;

namespace Juple.IntegrationTests.Storage;

/// <summary>
/// Minimal smoke test against a real local Azurite (see infra/local/compose.yaml) - not a fake or
/// mock. Confirms BlobServiceClientFactory's connection-string path actually reaches Blob Storage,
/// not just that it compiles.
/// </summary>
public sealed class BlobStorageIntegrationTests
{
    private const string SmokeTestContainerName = "item-images-smoke-test";

    [Fact]
    public async Task Container_ConnectUploadReadDelete_RoundTrips()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:BlobStorage"] = "UseDevelopmentStorage=true",
            })
            .Build();

        var blobServiceClient = BlobServiceClientFactory.Create(configuration);
        var containerClient = blobServiceClient.GetBlobContainerClient(SmokeTestContainerName);
        await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

        var blobName = $"smoke-test/{Guid.NewGuid():N}.txt";
        var blobClient = containerClient.GetBlobClient(blobName);
        var content = $"juple-blob-smoke-test-{Guid.NewGuid():N}";

        try
        {
            await using (var uploadStream = new MemoryStream(Encoding.UTF8.GetBytes(content)))
            {
                await blobClient.UploadAsync(uploadStream);
            }

            Assert.True(await blobClient.ExistsAsync());

            var downloaded = await blobClient.DownloadContentAsync();
            Assert.Equal(content, downloaded.Value.Content.ToString());
        }
        finally
        {
            await blobClient.DeleteIfExistsAsync();
        }

        Assert.False(await blobClient.ExistsAsync());
    }
}
