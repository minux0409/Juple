namespace Juple.Application.Items.InstagramMetadataRetry;

public sealed record InstagramMetadataRetryRunResult(
    int DueTaskCount, int Resolved, int Rescheduled, int GaveUp, int AlreadySatisfied, int SkippedNotClaimed);

/// <summary>
/// One full pass of the Instagram metadata retry backstop: registers any newly eligible Items,
/// then attempts every currently due task once. See Program.cs's --run-instagram-metadata-retry
/// one-shot mode - the scheduled-Job entry point that calls this, same pattern as
/// IBlobCleanupService.RunPendingCleanupsAsync.
/// </summary>
public interface IInstagramMetadataRetryService
{
    Task<InstagramMetadataRetryRunResult> RunOnceAsync(CancellationToken cancellationToken = default);
}
