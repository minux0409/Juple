using Juple.Application.Images;

namespace Juple.Application.Inbox.GetDailyInbox;

public sealed class GetDailyInboxService(
    IInboxEntryStore inboxEntryStore,
    IItemImageStorage itemImageStorage,
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
        var (items, representativeImages) = await inboxEntryStore.GetDailyAsync(
            userId,
            range.FromUtc,
            range.ToUtc,
            cancellationToken);

        var enrichedItems = new List<DailyInboxEntryDto>(items.Count);
        foreach (var item in items)
        {
            var representativeImage = representativeImages.TryGetValue(item.Id, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage });
        }

        return new DailyInboxResult(requestedDate, enrichedItems);
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        // A failed/missing read URL degrades to no representative image for this one Item rather
        // than failing the whole Inbox response - the DB row (source of truth) is unaffected;
        // Storage is only a supporting system for this optional thumbnail.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
