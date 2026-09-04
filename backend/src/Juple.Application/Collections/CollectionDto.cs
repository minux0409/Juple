namespace Juple.Application.Collections;

public sealed record CollectionDto(
    long Id,
    string Name,
    bool IsFavorite,
    int ItemCount,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);
