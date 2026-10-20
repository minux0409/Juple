namespace Juple.Application.DataExport;

/// <summary>The account itself, as the person sees it. Never the internal user id, the sign-in identity or a billing detail.</summary>
public sealed record DataExportAccount(
    string JupleId,
    string? DisplayName,
    string PreferredLocale,
    string TimeZoneId,
    string? DefaultCurrencyCode,
    DateTimeOffset CreatedAtUtc,
    string? ProfileImageBlobName);

/// <summary>A photo the person uploaded to one of their own links (the main variant; thumbnails are derived copies and not exported).</summary>
public sealed record DataExportItemPhoto(long ImageId, string ContentType, long ByteLength, int SortOrder, DateTimeOffset CreatedAtUtc);

/// <summary>A Collection one of the person's links is in - only Collections the person owns or still belongs to.</summary>
public sealed record DataExportItemCollection(long CollectionId, DateTimeOffset AddedAtUtc);

/// <summary>One of the person's own saved links, including those in the trash (<see cref="DeletedAtUtc"/> set).</summary>
public sealed record DataExportItem(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    string? PreviewImageUrl,
    DateTimeOffset SavedAtUtc,
    DateTimeOffset? DeletedAtUtc,
    IReadOnlyList<DataExportItemPhoto> Photos,
    IReadOnlyList<DataExportItemCollection> Collections);

public sealed record DataExportShare(string PublicId, bool IsActive, bool IsPublic, string Permission);

/// <summary>How many people take part in an owned Collection, per role - counts only, never who they are.</summary>
public sealed record DataExportMemberCounts(int Contributors, int Submitters, int Viewers)
{
    public int Total => Contributors + Submitters + Viewers;
}

/// <summary>A Collection the person owns (not deleted). Lock and share passwords are never part of it.</summary>
public sealed record DataExportOwnedCollection(
    long Id,
    string Name,
    string Icon,
    string? Color,
    bool IsFavorite,
    bool IsLocked,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string? IconImageBlobName,
    DataExportShare? Share,
    DataExportMemberCounts Members);

/// <summary>
/// One link in a Collection the person owns. The person's own link is referenced by <see cref="ItemId"/> (its details are in the links
/// file). A link another member added is described only by what every member already sees - URL, title and automatic preview - never
/// its memo, photos, item id or who added it.
/// </summary>
public sealed record DataExportCollectionEntry(
    long CollectionId,
    bool IsMine,
    long? ItemId,
    string? Url,
    string? Title,
    string? PreviewImageUrl,
    DateTimeOffset AddedAtUtc);

/// <summary>A shared Collection someone else owns that the person belongs to: the name, the person's role and when they joined.</summary>
public sealed record DataExportMembership(long CollectionId, string Name, string Role, DateTimeOffset JoinedAtUtc);

/// <summary>A comment the person wrote (not deleted). Other people's comments are never exported.</summary>
public sealed record DataExportComment(long Id, long CollectionId, long ItemId, string Body, DateTimeOffset CreatedAtUtc, bool IsReply);

public sealed record DataExportPurchase(
    long Id,
    long? ItemId,
    DateOnly PurchaseDate,
    string ProductName,
    decimal? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    decimal? Quantity,
    string? Memo,
    DateTimeOffset CreatedAtUtc);

public sealed record DataExportRepeatPurchase(
    long Id,
    long? ItemId,
    string ProductName,
    int IntervalValue,
    string IntervalUnit,
    DateOnly NextPurchaseDate,
    bool IsReminderEnabled,
    int ReminderLeadDays,
    bool IsEnabled,
    DateTimeOffset CreatedAtUtc);

/// <summary>A link photo to copy into a photo file. <see cref="BlobName"/> never leaves the server.</summary>
public sealed record DataExportImageRef(long ImageId, long ItemId, string BlobName, string ContentType, long ByteLength);

public sealed record DataExportCounts(
    int Links,
    int LinksInTrash,
    int OwnedCollections,
    int SharedMemberships,
    int Comments,
    int Purchases,
    int RepeatPurchases,
    int Photos,
    long PhotoBytes,
    long CollectionEntries = 0);

/// <summary>One numbered photo file: the photos with ids FromImageId..ThroughImageId (ordered by id).</summary>
public sealed record DataExportImagePart(int Number, long FromImageId, long ThroughImageId, int ImageCount, long ByteCount);

public sealed record DataExportSummary(DataExportCounts Counts, IReadOnlyList<DataExportImagePart> ImageParts);

/// <summary>A link that was just created (one per file of the export). <see cref="Token"/> is shown once (inside the download path) and stored only as a hash.</summary>
public sealed record DataExportLinkCreated(Juple.Domain.Users.DataExportPart Part, int? PhotoFileNumber, string Token, DateTimeOffset ExpiresAtUtc, string FileName, int? PhotoCount, long? ByteCount);

/// <summary>What a valid download link entitles its holder to - resolved from the stored link, never from the request.</summary>
public sealed record DataExportDownload(long UserId, Juple.Domain.Users.DataExportPart Part, int? ImagePartNumber, long? FromImageId, long? ThroughImageId, string FileName, IReadOnlyList<DataExportImagePart>? ImageParts = null);

public sealed class DataExportDisabledException() : Exception("Data export is not enabled.");

public sealed class DataExportRateLimitedException() : Exception("Too many export downloads were requested today.");

public sealed class DataExportPartNotFoundException() : Exception("There is no such export file.");

public sealed class DataExportLimitExceededException() : Exception("This export exceeds the configured processing limits.");
