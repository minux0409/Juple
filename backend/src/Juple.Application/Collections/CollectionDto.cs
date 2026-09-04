namespace Juple.Application.Collections;

public sealed record CollectionDto(
    long Id,
    string Name,
    int ItemCount,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);
