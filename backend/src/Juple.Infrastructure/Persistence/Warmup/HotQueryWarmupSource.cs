using Juple.Application.Collections.ListCollections;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Users.CurrentUser;

namespace Juple.Infrastructure.Persistence.Warmup;

/// <summary>
/// The query shapes the signed-in app runs first (measured on Dev: the first Home after a start paid 0.6-1.1 s PER SHAPE on top of the
/// process start-up cost). Each is the very expression its store runs - taken through the store's own builder with a sink - translated
/// with placeholder parameter values: NO command is executed, no connection is opened, no person's id, item or Collection is used.
/// Shapes that several endpoints share are listed once.
///
/// Deliberately NOT here: the name-ordered Archive page (its cost is steady-state SQL, a separate problem), searches, cursors (the
/// same shape with one more predicate, translated the first time they are used), and the per-request detail reads (Quick Detail,
/// item images) whose queries are small inline reads inside their services.
/// </summary>
public sealed class HotQueryWarmupSource(JupleDbContext dbContext) : IQueryWarmupSource
{
    public IReadOnlyList<QueryWarmup> Queries() =>
    [
        // Every authenticated request: who is this.
        new("CurrentUserIdentity", (sink, _) =>
        {
            sink.Capture(CurrentJupleUserAccessor.Query(dbContext, Guid.Empty, Guid.Empty));
            return Task.CompletedTask;
        }),
        // The bell, on every page.
        new("NotificationsUnreadCount", (sink, _) =>
        {
            sink.Capture(new NotificationInboxStore(dbContext).UnreadQuery(0));
            return Task.CompletedTask;
        }),
        // Home: today's links, today's count, and the Collections summary.
        new("HomeHistory", (sink, cancellationToken) => new ItemStore(dbContext).TranslateHomeQueriesAsync(sink, "history", cancellationToken)),
        new("HomeHistoryCount", (sink, cancellationToken) => new ItemStore(dbContext).TranslateHomeQueriesAsync(sink, "count", cancellationToken)),
        new("HomeSummary", (sink, cancellationToken) => new CollectionStore(dbContext).TranslateHomeSummaryAsync(sink, cancellationToken)),
        // The Collections page (its default filter first) and the picker-style lists.
        new("CollectionsFavorites", (sink, cancellationToken) => new CollectionStore(dbContext).TranslateListQueriesAsync(sink, CollectionListScope.Favorites, cancellationToken)),
        new("CollectionsAll", (sink, cancellationToken) => new CollectionStore(dbContext).TranslateListQueriesAsync(sink, CollectionListScope.All, cancellationToken)),
        new("CollectionsShared", (sink, cancellationToken) => new CollectionStore(dbContext).TranslateListQueriesAsync(sink, CollectionListScope.Shared, cancellationToken)),
    ];
}
