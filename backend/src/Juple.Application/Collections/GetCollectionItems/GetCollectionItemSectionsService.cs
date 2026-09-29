using Juple.Application.Collections.Access;
using Juple.Application.Items.GetItemHistorySections;

namespace Juple.Application.Collections.GetCollectionItems;

/// <summary>
/// A Collections 일자순 summary: the same 오늘 / 어제 / 이번 주 / month windows as History (one
/// grouping rule - HistorySectionRanges, in the callers stored TimeZoneId) over when each link was
/// added, with every windows exact count in one statement - never the links themselves. The
/// client then pages each expanded section on its own (IGetCollectionItemsService.GetRangeAsync).
/// </summary>
public sealed class GetCollectionItemSectionsService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    TimeProvider timeProvider) : IGetCollectionItemSectionsService
{
    public async Task<IReadOnlyList<CollectionItemSectionDto>> GetAsync(
        long userId,
        long collectionId,
        string timeZoneId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);

        var (recent, monthsBeforeUtc) = HistorySectionRanges.Recent(timeProvider.GetUtcNow(), timeZoneId);
        var ranges = new List<HistorySectionRange>(recent);
        var oldest = await collectionItemStore.GetOldestAddedAtUtcAsync(userId, collectionId, monthsBeforeUtc, cancellationToken);
        if (oldest is { } oldestAddedAtUtc)
        {
            ranges.AddRange(HistorySectionRanges.Months(monthsBeforeUtc, oldestAddedAtUtc, timeZoneId));
        }

        var counts = await collectionItemStore.CountByAddedRangesAsync(
            userId,
            collectionId,
            ranges.Select(range => (range.FromUtc, range.ToUtc ?? DateTimeOffset.MaxValue)).ToList(),
            cancellationToken);

        return ranges
            .Select((range, index) => new CollectionItemSectionDto(range.Key, range.Kind, range.Year, range.Month, range.FromUtc, range.ToUtc, counts[index]))
            .Where(section => section.Count > 0)
            .ToList();
    }
}
