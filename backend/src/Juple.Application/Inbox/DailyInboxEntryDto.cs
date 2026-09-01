using Juple.Application.Items;

namespace Juple.Application.Inbox;

public sealed record DailyInboxEntryDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    ItemCategoryDto? Category);
