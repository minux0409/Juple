namespace Juple.Application.Inbox.GetDailyInbox;

public sealed record DailyInboxResult(DateOnly Date, IReadOnlyList<DailyInboxEntryDto> Items);