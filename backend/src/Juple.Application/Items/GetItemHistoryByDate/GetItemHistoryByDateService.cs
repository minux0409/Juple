using Juple.Application.Images;
using Juple.Application.Inbox.GetDailyInbox;

namespace Juple.Application.Items.GetItemHistoryByDate;

/// <summary>
/// Reuses DailyInboxDateRangeCalculator - a TimeZoneInfo-based local-date-to-UTC-window
/// conversion, never a UTC substring. timeZoneId is always the caller's CurrentJupleUser.TimeZoneId
/// (the User's stored bootstrap timezone) - never a second, independently-sourced timezone value.
///
/// Known edge (not addressed here - see product-overview.md's device-Intl-timezone bootstrap
/// flow): if the device's timezone changes mid-session, User.TimeZoneId only catches up on the
/// next bootstrap call, so Mobile's live device-local "today" and this endpoint's stored
/// timeZoneId can disagree briefly.
/// </summary>
public sealed class GetItemHistoryByDateService(
    IItemHistoryQueryStore itemHistoryQueryStore,
    IItemImageStorage itemImageStorage) : IGetItemHistoryByDateService
{
    public async Task<ItemHistoryByDateResult> GetAsync(
        long userId,
        string timeZoneId,
        DateOnly date,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var range = DailyInboxDateRangeCalculator.Calculate(date, timeZoneId);
        var (page, representativeImages) = await itemHistoryQueryStore.GetByDateRangeAsync(
            userId, range.FromUtc, range.ToUtc, cursor, limit, cancellationToken);

        var enrichedItems = new List<ItemHistoryEntryDto>(page.Items.Count);
        foreach (var item in page.Items)
        {
            var representativeImage = representativeImages.TryGetValue(item.Id, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage });
        }

        return new ItemHistoryByDateResult(date, enrichedItems, page.NextCursor);
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        // Same degrade-gracefully policy as GetItemHistoryService: a failed/missing read URL drops
        // the representative image for this one Item rather than failing the whole response.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
