namespace Juple.Application.Collections;

/// <summary>
/// PublicId only - never the canonical share URL (composed by the API layer from PublicWebOptions,
/// so the Application layer never needs to know the public web's base URL) and never the
/// Collection's internal bigint Id.
/// </summary>
public sealed record CollectionShareDto(long CollectionId, string PublicId, DateTimeOffset CreatedAtUtc);
