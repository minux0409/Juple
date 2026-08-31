namespace Juple.Application.Inbox.SaveInboxEntry;

public sealed class InboxEntrySaveService(
    IInboxEntryStore inboxEntryStore,
    TimeProvider timeProvider) : IInboxEntrySaveService
{
    public Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateUrl(command.Url);
        return inboxEntryStore.SaveAsync(
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
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidInboxRequestException("url", "A valid HTTP or HTTPS URL is required.");
        }

        return trimmedUrl;
    }
}