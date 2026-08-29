namespace Juple.Application.Inbox.GetDailyInbox;

public interface IGetDailyInboxService
{
    Task<DailyInboxResult> GetAsync(
        long userId,
        string timeZoneId,
        DateOnly? date,
        CancellationToken cancellationToken = default);
}