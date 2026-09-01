namespace Juple.Application.Items;

/// <summary>The Category reference embedded in Item read responses - id/name only, no SortOrder.</summary>
public sealed record ItemCategoryDto(long Id, string Name);
