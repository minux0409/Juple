using Juple.Application.UrlSafety;
using Juple.Application.UrlMetadata;

namespace Juple.Application.Inbox.SaveInboxEntry;

public sealed class InboxEntrySaveService(
    IInboxEntryStore inboxEntryStore,
    TimeProvider timeProvider,
    IUrlSafetyChecker urlSafetyChecker,
    IUrlMetadataResolver urlMetadataResolver) : IInboxEntrySaveService
{
    public async Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateUrl(command.Url);
        UrlSafetyCheckException.ThrowIfNotAllowed(await urlSafetyChecker.CheckAsync(url, cancellationToken));
        // Best-effort metadata runs only after reputation approval. The existing client backfill
        // consumes the resolver's cached result; persistence and its replay contract stay unchanged.
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
