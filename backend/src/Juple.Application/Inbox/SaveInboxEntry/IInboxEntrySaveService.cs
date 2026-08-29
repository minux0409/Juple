namespace Juple.Application.Inbox.SaveInboxEntry;

public interface IInboxEntrySaveService
{
    Task<InboxEntryDto> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        CancellationToken cancellationToken = default);
}