namespace Juple.Application.Inbox;

public interface IInboxEntryStore
{
    Task<InboxEntryDto> SaveAsync(
        long userId,
        string url,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InboxEntryDto>> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default);
}