namespace Juple.Application.Inbox;

public interface IInboxEntryStore
{
    Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        string url,
        Guid? clientRequestId,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default);
}
