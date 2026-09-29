namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemSectionsService
{
    /// <summary>
    /// The Collections non-empty date sections, newest first, with exact counts - no link data.
    /// Same gates as IGetCollectionItemsService.GetAsync (Owner or member; a locked Collection needs
    /// a valid unlock grant - CollectionLockedException otherwise).
    /// </summary>
    Task<IReadOnlyList<CollectionItemSectionDto>> GetAsync(
        long userId,
        long collectionId,
        string timeZoneId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
