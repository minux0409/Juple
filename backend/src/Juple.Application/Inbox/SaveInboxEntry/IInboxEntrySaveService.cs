namespace Juple.Application.Inbox.SaveInboxEntry;

public interface IInboxEntrySaveService
{
    Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        CancellationToken cancellationToken = default);
}