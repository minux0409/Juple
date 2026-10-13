namespace Juple.Application.Collections.HomeSummary;

public interface IHomeCollectionsSummaryService
{
    /// <summary>How many favorite Collections the summary lists as shortcuts at most (Home shows six).</summary>
    public const int FavoriteShortcutLimit = 6;

    Task<HomeCollectionsSummary> GetAsync(long userId, CancellationToken cancellationToken = default);
}
