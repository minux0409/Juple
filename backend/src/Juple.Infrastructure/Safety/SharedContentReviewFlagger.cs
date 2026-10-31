using Juple.Application.Safety;
using Juple.Domain.Safety;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Safety;

public sealed class SharedContentReviewFlagger(ISafetyStore store, TimeProvider timeProvider, ILogger<SharedContentReviewFlagger> logger) : ISharedContentReviewFlagger
{
    public Task FlagCommentAsync(long authorUserId, long collectionId, long commentId, string body, CancellationToken cancellationToken = default) =>
        RunAsync(async () =>
        {
            if (SharedContentFilter.CheckText(body) is { } rule)
            {
                await store.AddAutoFilterReportAsync(
                    ContentReport.FromAutoFilter(ReportTargetType.Comment, commentId, authorUserId, collectionId, rule, timeProvider.GetUtcNow(), body, null), cancellationToken);
            }
        });

    public Task FlagLinkAsync(long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        RunAsync(async () =>
        {
            if (await store.GetSharedLinkAsync(collectionId, itemId, cancellationToken) is { } link
                && (SharedContentFilter.CheckUrl(link.Url) ?? SharedContentFilter.CheckText(link.Title)) is { } rule)
            {
                await store.AddAutoFilterReportAsync(
                    ContentReport.FromAutoFilter(ReportTargetType.Item, itemId, link.OwnerUserId, collectionId, rule, timeProvider.GetUtcNow(), link.Title, link.Url), cancellationToken);
            }
        });

    public Task FlagCollectionNameAsync(long collectionId, CancellationToken cancellationToken = default) =>
        RunAsync(async () =>
        {
            if (await store.GetSharedCollectionAsync(collectionId, cancellationToken) is { } collection
                && SharedContentFilter.CheckText(collection.Name) is { } rule)
            {
                await store.AddAutoFilterReportAsync(
                    ContentReport.FromAutoFilter(ReportTargetType.Collection, collectionId, collection.OwnerUserId, collectionId, rule, timeProvider.GetUtcNow(), collection.Name, null), cancellationToken);
            }
        });

    private async Task RunAsync(Func<Task> check)
    {
        try
        {
            await check();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "safety.autofilter.failed");
        }
    }
}
