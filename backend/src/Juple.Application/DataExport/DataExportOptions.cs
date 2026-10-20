namespace Juple.Application.DataExport;

/// <summary>
/// Bound from the "DataExport" configuration section. <see cref="Enabled"/> defaults to false: the endpoints answer 404 and the
/// bootstrap tells the apps to show no export entry, so shipping this code changes nothing until the switch is turned on.
/// Export is independent of the subscription program (it is a person's right to their own data, in every billing state).
/// </summary>
public sealed class DataExportOptions
{
    public const string SectionName = "DataExport";

    public bool Enabled { get; set; }

    /// <summary>Upper bound of the photo bytes in one photo file; more photos are split into further numbered files.</summary>
    public long MaxImageBytesPerPart { get; set; } = 256L * 1024 * 1024;

    /// <summary>Upper bound of the photos in one photo file (keeps one download short however small the photos are).</summary>
    public int MaxImagesPerPart { get; set; } = 1000;

    /// <summary>How long a download link works after it was created (one export request creates the links for all its files at once).</summary>
    public int LinkLifetimeMinutes { get; set; } = 15;

    /// <summary>Must remain one. Retained for configuration validation; the database independently enforces single consumption.</summary>
    public int MaxUsesPerLink { get; set; } = 1;

    /// <summary>How many export requests (each: the links for every file) one person may make in 24 hours.</summary>
    public int MaxExportsPerDay { get; set; } = 10;

    public int MaxDownloadSeconds { get; set; } = 120;
    public long MaxArchiveBytes { get; set; } = 512L * 1024 * 1024;
    public int MaxRecords { get; set; } = 100_000;
    public int MaxCollections { get; set; } = 5_000;
    public int MaxArchiveEntries { get; set; } = 6_000;

    public TimeSpan LinkLifetime => TimeSpan.FromMinutes(LinkLifetimeMinutes);

    /// <summary>Returns the first invalid setting, or null. The API refuses to start on an invalid configuration.</summary>
    public string? Validate()
    {
        if (MaxDownloadSeconds is < 1 or > 600 || MaxArchiveBytes is < 1024 * 1024 or > 1024L * 1024 * 1024
            || MaxRecords is < 1 or > 1_000_000 || MaxCollections is < 1 or > 10_000 || MaxArchiveEntries is < 10 or > 20_000)
        {
            return "DataExport resource limits are outside their safe ranges.";
        }

        if (MaxImageBytesPerPart < 1024 * 1024)
        {
            return "DataExport:MaxImageBytesPerPart must be at least 1 MiB.";
        }

        if (MaxImagesPerPart < 1)
        {
            return "DataExport:MaxImagesPerPart must be at least 1.";
        }

        if (LinkLifetimeMinutes is < 1 or > 15)
        {
            return "DataExport:LinkLifetimeMinutes must be between 1 and 15.";
        }

        if (MaxUsesPerLink != 1)
        {
            return "DataExport:MaxUsesPerLink must be 1.";
        }

        if (MaxExportsPerDay < 1)
        {
            return "DataExport:MaxExportsPerDay must be at least 1.";
        }

        return null;
    }
}
