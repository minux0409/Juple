using Azure.Storage.Blobs;
using Juple.Infrastructure.Images;

namespace Juple.Api.Storage;

/// <summary>
/// HTTP API only (registered in Program.cs for the API path, never for the one-shot Jobs): right
/// after the API starts, fetches the User Delegation Key once in the background, so the first
/// request that needs an image read URL - typically the Collections or History list, with the
/// app's 8-second GET timeout - finds it cached instead of waiting for a fresh process's first
/// Managed Identity token. It never delays startup or /health, is tried once (no retry loop), and a
/// failure only leaves the ordinary per-request fetch to try again. A request arriving while it is
/// still running simply waits for the same fetch (see UserDelegationKeyCache). Skipped where a
/// Shared Key signs read URLs locally (Azurite/local), which needs no delegation key at all.
/// </summary>
public sealed class UserDelegationKeyWarmupService(
    BlobServiceClient blobServiceClient,
    UserDelegationKeyCache userDelegationKeyCache,
    ILogger<UserDelegationKeyWarmupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Hand startup back at once - nothing below may hold up the host or /health.
        await Task.Yield();

        if (blobServiceClient.CanGenerateAccountSasUri)
        {
            return;
        }

        try
        {
            await userDelegationKeyCache.GetOrRefreshAsync(UserDelegationKeyAcquisitionSource.Warmup, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down - nothing to do.
        }
        catch (Exception exception)
        {
            // Already logged in detail by the cache (elapsed, status, error code). Never rethrown:
            // a failed warm-up must not stop the host.
            logger.LogInformation(
                "User delegation key warm-up did not complete ({ExceptionType}); requests will fetch it when needed.",
                exception.GetType().Name);
        }
    }
}
