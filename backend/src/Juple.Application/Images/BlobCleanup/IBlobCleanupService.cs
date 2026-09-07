namespace Juple.Application.Images.BlobCleanup;

public sealed record BlobCleanupRunResult(int Pending, int Succeeded, int Failed);

/// <summary>
/// Finishes durable Blob cleanup tasks left behind by account deletion (see
/// AccountDeletionBlobCleanup/AccountDeletionStore). Neither method throws - a Blob Storage
/// failure here must never surface as a failure of whatever triggered it (an account deletion
/// request, or a scheduled retry run).
/// </summary>
public interface IBlobCleanupService
{
    /// <summary>
    /// Attempts cleanup for one specific pending task, right after it was created - the immediate,
    /// best-effort attempt DeleteAccountService makes before returning. Returns whether the task
    /// was fully cleaned up and removed (true) or left/updated for a later retry (false). A
    /// missing/already-removed task (e.g. a concurrent retry run already finished it) also
    /// returns true - there is nothing left to do.
    /// </summary>
    Task<bool> TryCleanupAsync(long cleanupTaskId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Processes every currently pending task - the retry/maintenance entry point (see Program.cs's
    /// --run-blob-cleanup-retry one-shot mode, mirroring IDispatchDuePushNotificationsService's
    /// shape). One task's failure never stops the rest from being attempted.
    /// </summary>
    Task<BlobCleanupRunResult> RunPendingCleanupsAsync(CancellationToken cancellationToken = default);
}
