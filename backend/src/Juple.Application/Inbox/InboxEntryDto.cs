namespace Juple.Application.Inbox;

public sealed record InboxEntryDto(long Id, string Url, DateTimeOffset SavedAtUtc);