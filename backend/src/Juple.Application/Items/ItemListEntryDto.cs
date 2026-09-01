namespace Juple.Application.Items;

public sealed record ItemListEntryDto(long Id, string Url, DateTimeOffset SavedAtUtc, DateTimeOffset StateChangedAtUtc);
