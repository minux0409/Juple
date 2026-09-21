namespace Juple.Application.Collections;

/// <summary>Color is null only for a Collection that predates this feature (or was
/// system-seeded without one) - see Collection.Color's own remarks on the client-side fallback.</summary>
public sealed record CollectionDto(
    long Id,
    string Name,
    bool IsFavorite,
    int ItemCount,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string Icon,
    string? Color);
