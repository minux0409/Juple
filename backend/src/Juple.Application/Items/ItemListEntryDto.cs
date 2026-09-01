namespace Juple.Application.Items;

public sealed record ItemListEntryDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    DateTimeOffset StateChangedAtUtc,
    ItemCategoryDto? Category);
