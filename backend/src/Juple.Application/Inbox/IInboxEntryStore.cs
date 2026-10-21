namespace Juple.Application.Inbox;

public interface IInboxEntryStore
{
    Task<InboxEntrySaveResult?> FindReplayAsync(long userId, Guid clientRequestId, string url, CancellationToken cancellationToken = default);

    Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        string url,
        Guid? clientRequestId,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default);
}
