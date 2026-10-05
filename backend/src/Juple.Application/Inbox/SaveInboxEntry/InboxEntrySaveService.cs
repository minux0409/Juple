using Juple.Application.Collections.Public;
using Juple.Application.UrlMetadata;

namespace Juple.Application.Inbox.SaveInboxEntry;

public sealed class InboxEntrySaveService(
    IInboxEntryStore inboxEntryStore,
    TimeProvider timeProvider,
    IUrlMetadataResolver urlMetadataResolver,
    ICollectionShareUrlDetector collectionShareUrlDetector) : IInboxEntrySaveService
{
    public async Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateUrl(command.Url);
        // The product invariant: a Collection share link is never an ordinary saved link (checked before anything
        // is fetched or written - the one shared gate of every normal save).
        if (collectionShareUrlDetector.FindPublicId(url) is { } sharedPublicId)
        {
            throw new CollectionShareUrlNotSavableException(sharedPublicId);
        }

        // Best-effort metadata fetch is guarded by the resolver's SSRF/DNS protections.
        await urlMetadataResolver.ResolveAsync(url, cancellationToken);
        return await inboxEntryStore.SaveAsync(
            userId,
            url,
            command.ClientRequestId,
            timeProvider.GetUtcNow(),
            cancellationToken);
    }

    private static string ValidateUrl(string? url)
    {
        var trimmedUrl = url?.Trim();
        if (string.IsNullOrEmpty(trimmedUrl)
            || trimmedUrl.Length > 4096
            || !Uri.TryCreate(trimmedUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrEmpty(uri.Host))
        {
            throw new InvalidInboxRequestException("url", "A valid HTTP or HTTPS URL is required.");
        }

        return trimmedUrl;
    }
}
