using Juple.Domain.Items;

namespace Juple.Application.Items;

public sealed record ItemDetailsDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    ItemState State,
    DateTimeOffset StateChangedAtUtc);
