namespace Juple.Application.Items.GetItemHistorySections;

/// <summary>
/// The History summary: every section's window and exact link count in two small indexed queries
/// (the oldest link before the month boundary, then all the counts at once) - never the links
/// themselves. timeZoneId is the caller's stored CurrentJupleUser.TimeZoneId, exactly like Home's
/// GET /api/v1/items/history/date (see GetItemHistoryByDateService for its known mid-session edge).
/// </summary>
public sealed class GetItemHistorySectionsService(
    IItemHistoryQueryStore itemHistoryQueryStore,
    TimeProvider timeProvider) : IGetItemHistorySectionsService
{
    public async Task<IReadOnlyList<ItemHistorySectionDto>> GetAsync(
        long userId,
        string timeZoneId,
        CancellationToken cancellationToken = default)
    {
        var (recent, monthsBeforeUtc) = HistorySectionRanges.Recent(timeProvider.GetUtcNow(), timeZoneId);
        var ranges = new List<HistorySectionRange>(recent);
        var oldest = await itemHistoryQueryStore.GetOldestSavedAtUtcAsync(userId, monthsBeforeUtc, cancellationToken);
        if (oldest is { } oldestSavedAtUtc)
        {
            ranges.AddRange(HistorySectionRanges.Months(monthsBeforeUtc, oldestSavedAtUtc, timeZoneId));
        }

        var counts = await itemHistoryQueryStore.CountByRangesAsync(
            userId, ranges.Select(range => (range.FromUtc, range.ToUtc ?? DateTimeOffset.MaxValue)).ToList(), cancellationToken);

        return ranges
            .Select((range, index) => new ItemHistorySectionDto(range.Key, range.Kind, range.Year, range.Month, range.FromUtc, range.ToUtc, counts[index]))
            .Where(section => section.Count > 0)
            .ToList();
    }
}
