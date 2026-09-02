using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Juple.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;

namespace Juple.IntegrationTests.TestSupport;

/// <summary>
/// A real BlobContainerClient against the local Azurite (see infra/local/compose.yaml) - not a
/// fake or mock - shared across Integration test files that construct ItemStore/ItemImageStore
/// directly, most of which never touch a Blob themselves. The container is created at most once
/// per test run.
/// </summary>
internal static class TestBlobContainerClientFactory
{
    private const string ContainerName = "item-images";

    private static readonly Lazy<BlobContainerClient> LazyClient = new(CreateAndEnsureContainer);

    internal static BlobContainerClient Create() => LazyClient.Value;

    /// <summary>
    /// A real BlobContainerClient pointed at a container that is never created - a deterministic
    /// way to make Blob Storage calls fail (e.g. GetBlobsAsync enumeration) for tests that verify
    /// best-effort cleanup swallows a Storage-side failure rather than propagating it.
    /// </summary>
    internal static BlobContainerClient CreateForMissingContainer() =>
        CreateBlobServiceClient().GetBlobContainerClient($"missing-container-{Guid.NewGuid():N}");

    private static BlobContainerClient CreateAndEnsureContainer()
    {
        var containerClient = CreateBlobServiceClient().GetBlobContainerClient(ContainerName);
        containerClient.CreateIfNotExists(PublicAccessType.None);
        return containerClient;
    }

    private static BlobServiceClient CreateBlobServiceClient()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:BlobStorage"] =
                    Environment.GetEnvironmentVariable("ConnectionStrings__BlobStorage")
                    ?? "UseDevelopmentStorage=true",
            })
            .Build();

        return BlobServiceClientFactory.Create(configuration);
    }
}
