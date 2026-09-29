namespace Juple.Application.Items.GetItemHistorySections;

public interface IGetItemHistorySectionsService
{
    /// <summary>The caller's non-empty History sections, newest first, with exact counts - no link data.</summary>
    Task<IReadOnlyList<ItemHistorySectionDto>> GetAsync(long userId, string timeZoneId, CancellationToken cancellationToken = default);
}
