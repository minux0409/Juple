namespace Juple.Domain.Users;

/// <summary>Which file a data export download produces. Stored as a number; a value is only ever appended.</summary>
public enum DataExportPart
{
    /// <summary>The structured data (links, Collections, memberships, comments, purchases, account) plus the small profile/Collection photos.</summary>
    Data = 1,

    /// <summary>One bounded batch of the account's own uploaded link photos (<see cref="DataExportLink.FromImageId"/>..<see cref="DataExportLink.ThroughImageId"/>).</summary>
    Images = 2,
}

/// <summary>
/// A short-lived download link for the account's own data export (docs/RELEASE_BACKLOG.md "DATA RETENTION", RET-03).
///
/// The signed-in app asks for a link (recent sign-in required) and opens it in the browser / system downloader, which cannot send the
/// app's bearer token. Only the SHA-256 of the random token is stored, never the token. A link is valid for at most 15 minutes and one
/// successful claim, then it is worthless; the row stays only as the per-day rate-limit
/// count and is deleted with the account (FK cascade). An images link fixes its photo range when it is created, so the batch it
/// downloads never shifts while photos are added or removed.
/// </summary>
public sealed class DataExportLink
{
    private DataExportLink()
    {
    }

    public DataExportLink(
        long userId,
        byte[] tokenHash,
        DataExportPart part,
        int? imagePartNumber,
        long? fromImageId,
        long? throughImageId,
        DateTimeOffset createdAtUtc,
        DateTimeOffset expiresAtUtc,
        string? imagePlanJson = null)
    {
        if (tokenHash.Length != 32)
        {
            throw new ArgumentException("The token hash is a SHA-256 value (32 bytes).", nameof(tokenHash));
        }

        if (part == DataExportPart.Images && (imagePartNumber is null || fromImageId is null || throughImageId is null || fromImageId > throughImageId))
        {
            throw new ArgumentException("An images link needs its part number and a non-empty photo range.");
        }

        if (part == DataExportPart.Data && (imagePartNumber is not null || fromImageId is not null || throughImageId is not null))
        {
            throw new ArgumentException("A data link has no photo range.");
        }

        if (expiresAtUtc <= createdAtUtc || expiresAtUtc > createdAtUtc.AddMinutes(15))
        {
            throw new ArgumentException("A link must expire within 15 minutes after it is created.", nameof(expiresAtUtc));
        }

        UserId = userId;
        TokenHash = tokenHash;
        Part = part;
        ImagePartNumber = imagePartNumber;
        FromImageId = fromImageId;
        ThroughImageId = throughImageId;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
        ImagePlanJson = imagePlanJson;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public byte[] TokenHash { get; private set; } = [];

    public DataExportPart Part { get; private set; }

    /// <summary>1-based photo batch number (Images only) - only for the file name.</summary>
    public int? ImagePartNumber { get; private set; }

    public long? FromImageId { get; private set; }

    public long? ThroughImageId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    /// <summary>The data file's photo ranges as issued; later additions/removals never renumber its companion files.</summary>
    public string? ImagePlanJson { get; private set; }

    /// <summary>Zero before the download authorization is claimed, one afterwards. A failed transfer needs a new token.</summary>
    public int UseCount { get; private set; }

    public DateTimeOffset? LastUsedAtUtc { get; private set; }
}
