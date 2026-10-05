using Juple.Application.Collections.Access;
using Juple.Application.Items.GetItemHistoryCalendar;

namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemCalendarService
{
    /// <summary>
    /// A Collection's links per local day (when each was ADDED to it, like the 일자순 sections) for one
    /// month - counts only. Same gates as the item list (Owner or member; a locked / share-password
    /// Collection needs its grant).
    /// </summary>
    Task<CalendarMonthDto> GetAsync(
        long userId,
        long collectionId,
        string timeZoneId,
        int year,
        int month,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}

public sealed class GetCollectionItemCalendarService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore) : IGetCollectionItemCalendarService
{
    public async Task<CalendarMonthDto> GetAsync(
        long userId,
        long collectionId,
        string timeZoneId,
        int year,
        int month,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        var days = CalendarMonthRanges.Days(year, month, timeZoneId);
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var counts = await collectionItemStore.CountByAddedRangesAsync(
            userId, collectionId, days.Select(day => (day.FromUtc, day.ToUtc)).ToList(), cancellationToken);
        return CalendarMonthRanges.ToMonth(year, month, days, counts);
    }
}
