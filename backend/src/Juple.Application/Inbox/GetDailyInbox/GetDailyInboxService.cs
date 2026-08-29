namespace Juple.Application.Inbox.GetDailyInbox;

public sealed class GetDailyInboxService(
    IInboxEntryStore inboxEntryStore,
    TimeProvider timeProvider) : IGetDailyInboxService
{
    public async Task<DailyInboxResult> GetAsync(
        long userId,
        string timeZoneId,
        DateOnly? date,
        CancellationToken cancellationToken = default)
    {
        var requestedDate = date
            ?? DailyInboxDateRangeCalculator.GetLocalDate(timeProvider.GetUtcNow(), timeZoneId);
        var range = DailyInboxDateRangeCalculator.Calculate(requestedDate, timeZoneId);
        var items = await inboxEntryStore.GetDailyAsync(
            userId,
            range.FromUtc,
            range.ToUtc,
            cancellationToken);

        return new DailyInboxResult(requestedDate, items);
    }
}