using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Juple.Application.DataExport;

/// <summary>
/// Writes one export file as a ZIP straight into <c>output</c> (the HTTP response), entry by entry: JSON and CSV are written with a
/// bounded buffer that is flushed every few records, photos are copied stream to stream. Nothing is collected in memory beyond one page
/// of rows and the person's Collection names, and nothing is written to disk. Every write is asynchronous (the web server refuses
/// synchronous I/O on a response).
///
/// Privacy rules (the reader enforces the same by query; this class never adds anything): only the person's own links, memos, photos,
/// comments and purchases; Collections they own (with counts of members, never who) and the names/roles of shared Collections they
/// belong to; another member's link in an owned Collection only as URL, title and automatic preview. No password, lock secret, share
/// password, token, internal account id or storage path is ever written.
/// </summary>
public sealed class DataExportArchiveWriter(IDataExportReader reader, IDataExportFileSource files, TimeProvider timeProvider, DataExportOptions? options = null)
{
    private readonly DataExportOptions limits = options ?? new DataExportOptions();
    public const string FormatName = "juple-data-export";
    public const int FormatVersion = 1;

    private const int FlushEvery = 100;

    private static readonly JsonWriterOptions JsonOptions = new()
    {
        Indented = true,
        // The file is read by people and tools, never embedded in HTML: keep every language readable instead of \u-escaped.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    // Spreadsheet programs need the BOM to read UTF-8 CSV (Korean, Japanese, Arabic ... titles) correctly.
    private static readonly UTF8Encoding Utf8WithBom = new(encoderShouldEmitUTF8Identifier: true);

    public static string DataFileName(DateTimeOffset nowUtc) =>
        $"juple-export-{nowUtc.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}.zip";

    public static string ImagesFileName(DateTimeOffset nowUtc, int partNumber) =>
        $"juple-export-{nowUtc.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}-photos-{partNumber.ToString(CultureInfo.InvariantCulture)}.zip";

    /// <summary>The path a link photo has inside the photo files - also what the links file points at, so unzipping both side by side matches.</summary>
    public static string PhotoPath(long itemId, long imageId, string contentType) =>
        $"photos/{itemId.ToString(CultureInfo.InvariantCulture)}-{imageId.ToString(CultureInfo.InvariantCulture)}.{ExtensionFor(contentType)}";

    public async Task WriteDataAsync(long userId, IReadOnlyList<DataExportImagePart> imageParts, Stream output, CancellationToken cancellationToken = default)
    {
        var exportedAtUtc = timeProvider.GetUtcNow();
        var account = await reader.GetAccountAsync(userId, cancellationToken) ?? throw new DataExportPartNotFoundException();
        var counts = await reader.GetCountsAsync(userId, cancellationToken);
        var owned = await reader.GetOwnedCollectionsAsync(userId, cancellationToken);
        var memberships = await reader.GetMembershipsAsync(userId, cancellationToken);
        var collectionNames = new Dictionary<long, string>();
        foreach (var collection in owned)
        {
            collectionNames[collection.Id] = collection.Name;
        }

        foreach (var membership in memberships)
        {
            collectionNames[membership.CollectionId] = membership.Name;
        }

        var missingFiles = 0;
        using var sink = new AsyncDrainStream(output, cancellationToken);
        var archive = await ZipArchive.CreateAsync(sink, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: null, cancellationToken);
        await using (archive.ConfigureAwait(false))
        {
            await WriteTextAsync(archive, sink, "README.txt", Readme(account.PreferredLocale), exportedAtUtc, cancellationToken);

            await WriteJsonAsync(archive, sink, "account.json", exportedAtUtc, writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("jupleId", account.JupleId);
                WriteNullableString(writer, "displayName", account.DisplayName);
                writer.WriteString("preferredLocale", account.PreferredLocale);
                writer.WriteString("timeZoneId", account.TimeZoneId);
                WriteNullableString(writer, "defaultCurrencyCode", account.DefaultCurrencyCode);
                writer.WriteString("createdAtUtc", account.CreatedAtUtc);
                WriteNullableString(writer, "profilePhotoFile", account.ProfileImageBlobName is null ? null : ProfilePhotoPath(account.ProfileImageBlobName));
                writer.WriteEndObject();
                return Task.CompletedTask;
            }, cancellationToken);

            await WriteJsonAsync(archive, sink, "links.json", exportedAtUtc, async writer =>
            {
                writer.WriteStartObject();
                writer.WriteStartArray("links");
                var written = 0;
                await foreach (var item in reader.ReadItemsAsync(userId, cancellationToken))
                {
                    WriteItem(writer, item, collectionNames, imageParts);
                    if (++written % FlushEvery == 0)
                    {
                        await writer.FlushAsync(cancellationToken);
                    }
                }

                writer.WriteEndArray();
                writer.WriteEndObject();
            }, cancellationToken);

            await WriteLinksCsvAsync(archive, sink, userId, collectionNames, exportedAtUtc, cancellationToken);

            await WriteJsonAsync(archive, sink, "collections.json", exportedAtUtc, async writer =>
            {
                writer.WriteStartObject();
                writer.WriteStartArray("ownedCollections");
                foreach (var collection in owned)
                {
                    await WriteOwnedCollectionAsync(writer, userId, collection, cancellationToken);
                    await writer.FlushAsync(cancellationToken);
                }

                writer.WriteEndArray();
                writer.WriteStartArray("sharedWithMe");
                foreach (var membership in memberships)
                {
                    writer.WriteStartObject();
                    writer.WriteNumber("id", membership.CollectionId);
                    writer.WriteString("name", membership.Name);
                    writer.WriteString("myRole", membership.Role);
                    writer.WriteString("joinedAtUtc", membership.JoinedAtUtc);
                    writer.WriteEndObject();
                }

                writer.WriteEndArray();
                writer.WriteEndObject();
            }, cancellationToken);

            await WriteJsonAsync(archive, sink, "comments.json", exportedAtUtc, async writer =>
            {
                writer.WriteStartObject();
                writer.WriteStartArray("comments");
                var written = 0;
                await foreach (var comment in reader.ReadCommentsAsync(userId, cancellationToken))
                {
                    writer.WriteStartObject();
                    writer.WriteNumber("id", comment.Id);
                    writer.WriteNumber("collectionId", comment.CollectionId);
                    WriteNullableString(writer, "collectionName", collectionNames.GetValueOrDefault(comment.CollectionId));
                    writer.WriteNumber("linkId", comment.ItemId);
                    writer.WriteString("body", comment.Body);
                    writer.WriteBoolean("isReply", comment.IsReply);
                    writer.WriteString("createdAtUtc", comment.CreatedAtUtc);
                    writer.WriteEndObject();
                    if (++written % FlushEvery == 0)
                    {
                        await writer.FlushAsync(cancellationToken);
                    }
                }

                writer.WriteEndArray();
                writer.WriteEndObject();
            }, cancellationToken);

            if (counts.Purchases > 0 || counts.RepeatPurchases > 0)
            {
                await WriteJsonAsync(archive, sink, "purchases.json", exportedAtUtc, async writer =>
                {
                    writer.WriteStartObject();
                    writer.WriteStartArray("purchases");
                    await foreach (var purchase in reader.ReadPurchasesAsync(userId, cancellationToken))
                    {
                        WritePurchase(writer, purchase);
                    }

                    writer.WriteEndArray();
                    writer.WriteStartArray("repeatPurchases");
                    await foreach (var repeat in reader.ReadRepeatPurchasesAsync(userId, cancellationToken))
                    {
                        WriteRepeatPurchase(writer, repeat);
                    }

                    writer.WriteEndArray();
                    writer.WriteEndObject();
                }, cancellationToken);
            }

            if (account.ProfileImageBlobName is { } profileBlob
                && await CopyFileAsync(archive, sink, userId, profileBlob, ProfilePhotoPath(profileBlob), exportedAtUtc, cancellationToken) is null)
            {
                missingFiles++;
            }

            foreach (var collection in owned)
            {
                if (collection.IconImageBlobName is { } iconBlob
                    && await CopyFileAsync(archive, sink, userId, iconBlob, CollectionPhotoPath(collection.Id, iconBlob), exportedAtUtc, cancellationToken) is null)
                {
                    missingFiles++;
                }
            }

            // Last, so it can say what (if anything) could not be included.
            await WriteJsonAsync(archive, sink, "manifest.json", exportedAtUtc, writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("format", FormatName);
                writer.WriteNumber("version", FormatVersion);
                writer.WriteString("file", "data");
                writer.WriteString("exportedAtUtc", exportedAtUtc);
                writer.WriteStartObject("counts");
                writer.WriteNumber("links", counts.Links);
                writer.WriteNumber("linksInTrash", counts.LinksInTrash);
                writer.WriteNumber("ownedCollections", counts.OwnedCollections);
                writer.WriteNumber("sharedCollectionsJoined", counts.SharedMemberships);
                writer.WriteNumber("comments", counts.Comments);
                writer.WriteNumber("purchases", counts.Purchases);
                writer.WriteNumber("repeatPurchases", counts.RepeatPurchases);
                writer.WriteNumber("photos", counts.Photos);
                writer.WriteNumber("photoBytes", counts.PhotoBytes);
                writer.WriteEndObject();
                writer.WriteStartArray("photoFiles");
                foreach (var part in imageParts)
                {
                    writer.WriteStartObject();
                    writer.WriteNumber("number", part.Number);
                    writer.WriteNumber("photos", part.ImageCount);
                    writer.WriteNumber("bytes", part.ByteCount);
                    writer.WriteEndObject();
                }

                writer.WriteEndArray();
                writer.WriteNumber("filesNotFound", missingFiles);
                writer.WriteEndObject();
                return Task.CompletedTask;
            }, cancellationToken);
        }

        // Closing the archive wrote the central directory into the buffer.
        await sink.FlushAsync(cancellationToken);
    }

    public async Task WriteImagesAsync(long userId, int partNumber, long fromImageId, long throughImageId, Stream output, CancellationToken cancellationToken = default)
    {
        var exportedAtUtc = timeProvider.GetUtcNow();
        var copied = 0;
        var missing = 0;
        long bytes = 0;
        using var sink = new AsyncDrainStream(output, cancellationToken);
        var archive = await ZipArchive.CreateAsync(sink,ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: null, cancellationToken);
        await using (archive.ConfigureAwait(false))
        {
            await foreach (var image in reader.ReadImagesAsync(userId, fromImageId, throughImageId, cancellationToken))
            {
                if (copied + missing >= Math.Min(limits.MaxImagesPerPart, limits.MaxArchiveEntries - 1)) throw new DataExportLimitExceededException();
                var copiedBytes = await CopyFileAsync(archive, sink, userId, image.BlobName, PhotoPath(image.ItemId, image.ImageId, image.ContentType), exportedAtUtc, cancellationToken, limits.MaxImageBytesPerPart - bytes);
                if (copiedBytes is not null)
                {
                    copied++;
                    bytes += copiedBytes.Value;
                }
                else
                {
                    missing++;
                }
            }

            await WriteJsonAsync(archive, sink, $"manifest-photos-{partNumber.ToString(CultureInfo.InvariantCulture)}.json", exportedAtUtc, writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("format", FormatName);
                writer.WriteNumber("version", FormatVersion);
                writer.WriteString("file", "photos");
                writer.WriteNumber("number", partNumber);
                writer.WriteString("exportedAtUtc", exportedAtUtc);
                writer.WriteNumber("photos", copied);
                writer.WriteNumber("bytes", bytes);
                writer.WriteNumber("filesNotFound", missing);
                writer.WriteEndObject();
                return Task.CompletedTask;
            }, cancellationToken);
        }

        // Closing the archive wrote the central directory into the buffer.
        await sink.FlushAsync(cancellationToken);
    }

    private async Task WriteOwnedCollectionAsync(Utf8JsonWriter writer, long userId, DataExportOwnedCollection collection, CancellationToken cancellationToken)
    {
        writer.WriteStartObject();
        writer.WriteNumber("id", collection.Id);
        writer.WriteString("name", collection.Name);
        writer.WriteString("icon", collection.Icon);
        WriteNullableString(writer, "color", collection.Color);
        writer.WriteBoolean("isFavorite", collection.IsFavorite);
        writer.WriteBoolean("isLocked", collection.IsLocked);
        writer.WriteString("createdAtUtc", collection.CreatedAtUtc);
        writer.WriteString("updatedAtUtc", collection.UpdatedAtUtc);
        WriteNullableString(writer, "photoFile", collection.IconImageBlobName is null ? null : CollectionPhotoPath(collection.Id, collection.IconImageBlobName));
        if (collection.Share is { } share)
        {
            writer.WriteStartObject("sharing");
            writer.WriteString("publicId", share.PublicId);
            writer.WriteBoolean("linkActive", share.IsActive);
            writer.WriteBoolean("isPublic", share.IsPublic);
            writer.WriteString("permission", share.Permission);
            writer.WriteEndObject();
        }
        else
        {
            writer.WriteNull("sharing");
        }

        writer.WriteStartObject("members");
        writer.WriteNumber("contributors", collection.Members.Contributors);
        writer.WriteNumber("submitters", collection.Members.Submitters);
        writer.WriteNumber("viewers", collection.Members.Viewers);
        writer.WriteEndObject();

        writer.WriteStartArray("links");
        var written = 0;
        await foreach (var entry in reader.ReadOwnedCollectionEntriesAsync(userId, collection.Id, cancellationToken))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("mine", entry.IsMine);
            if (entry.IsMine)
            {
                writer.WriteNumber("linkId", entry.ItemId!.Value);
            }
            else
            {
                writer.WriteString("url", entry.Url);
                WriteNullableString(writer, "title", entry.Title);
                WriteNullableString(writer, "previewImageUrl", entry.PreviewImageUrl);
            }

            writer.WriteString("addedAtUtc", entry.AddedAtUtc);
            writer.WriteEndObject();
            if (++written % FlushEvery == 0)
            {
                await writer.FlushAsync(cancellationToken);
            }
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void WriteItem(Utf8JsonWriter writer, DataExportItem item, IReadOnlyDictionary<long, string> collectionNames, IReadOnlyList<DataExportImagePart> imageParts)
    {
        writer.WriteStartObject();
        writer.WriteNumber("id", item.Id);
        writer.WriteString("url", item.Url);
        WriteNullableString(writer, "title", item.Title);
        WriteNullableString(writer, "memo", item.Memo);
        WriteNullableString(writer, "previewImageUrl", item.PreviewImageUrl);
        writer.WriteString("savedAtUtc", item.SavedAtUtc);
        writer.WriteBoolean("inTrash", item.DeletedAtUtc is not null);
        if (item.DeletedAtUtc is { } trashedAt)
        {
            writer.WriteString("movedToTrashAtUtc", trashedAt);
        }
        else
        {
            writer.WriteNull("movedToTrashAtUtc");
        }

        writer.WriteStartArray("photos");
        foreach (var photo in item.Photos)
        {
            var part = imageParts.FirstOrDefault(candidate => photo.ImageId >= candidate.FromImageId && photo.ImageId <= candidate.ThroughImageId);
            if (part is null) continue; // Uploaded after this export's photo files were issued.
            writer.WriteStartObject();
            writer.WriteString("file", PhotoPath(item.Id, photo.ImageId, photo.ContentType));
            if (part is not null)
            {
                writer.WriteNumber("photoFileNumber", part.Number);
            }
            else
            {
                writer.WriteNull("photoFileNumber");
            }

            writer.WriteString("contentType", photo.ContentType);
            writer.WriteNumber("byteLength", photo.ByteLength);
            writer.WriteString("addedAtUtc", photo.CreatedAtUtc);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();

        writer.WriteStartArray("collections");
        foreach (var collection in item.Collections)
        {
            writer.WriteStartObject();
            writer.WriteNumber("id", collection.CollectionId);
            WriteNullableString(writer, "name", collectionNames.GetValueOrDefault(collection.CollectionId));
            writer.WriteString("addedAtUtc", collection.AddedAtUtc);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private async Task WriteLinksCsvAsync(ZipArchive archive, AsyncDrainStream sink, long userId, IReadOnlyDictionary<long, string> collectionNames, DateTimeOffset exportedAtUtc, CancellationToken cancellationToken)
    {
        var entry = archive.CreateEntry("links.csv", CompressionLevel.Optimal);
        entry.LastWriteTime = exportedAtUtc;
        var stream = await entry.OpenAsync(cancellationToken);
        await using (stream.ConfigureAwait(false))
        {
            var text = new StreamWriter(stream, Utf8WithBom, bufferSize: 16 * 1024);
            await using (text.ConfigureAwait(false))
            {
                await text.WriteAsync("id,url,title,memo,saved_at_utc,in_trash,collections\r\n".AsMemory(), cancellationToken);
                var written = 0;
                await foreach (var item in reader.ReadItemsAsync(userId, cancellationToken))
                {
                    var names = string.Join(" | ", item.Collections.Select(collection => collectionNames.GetValueOrDefault(collection.CollectionId)).OfType<string>());
                    var line = string.Join(
                        ',',
                        item.Id.ToString(CultureInfo.InvariantCulture),
                        Csv(item.Url),
                        Csv(item.Title),
                        Csv(item.Memo),
                        item.SavedAtUtc.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
                        item.DeletedAtUtc is null ? "false" : "true",
                        Csv(names));
                    await text.WriteAsync((line + "\r\n").AsMemory(), cancellationToken);
                    if (++written % FlushEvery == 0)
                    {
                        await text.FlushAsync(cancellationToken);
                    }
                }

                await text.FlushAsync(cancellationToken);
            }
        }

        await sink.DrainAsync(cancellationToken);
    }

    /// <summary>
    /// One CSV field: quoted, quotes doubled, formula-like values prefixed with a tab for spreadsheet viewing.
    /// JSON keeps the exact original data. Spreadsheet import/re-save behavior varies; CSV is not executable trusted content.
    /// </summary>
    public static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        var trimmed = value.AsSpan().TrimStart();
        var formula = trimmed.Length > 0 && trimmed[0] is '=' or '+' or '-' or '@' or '＝' or '＋' or '－' or '＠';
        var safe = formula || value[0] is '\t' or '\r' or '\n' ? "\t" + value : value;
        return "\"" + safe.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private async Task<long?> CopyFileAsync(ZipArchive archive, AsyncDrainStream sink, long userId, string blobName, string entryName, DateTimeOffset exportedAtUtc, CancellationToken cancellationToken, long? maxBytes = null)
    {
        var source = await files.OpenReadAsync(userId, blobName, cancellationToken);
        if (source is null)
        {
            return null;
        }

        long copiedBytes = 0;
        await using (source.ConfigureAwait(false))
        {
            // Photos are already compressed (WebP/JPEG/PNG): storing them avoids burning CPU for nothing.
            var entry = archive.CreateEntry(entryName, CompressionLevel.NoCompression);
            entry.LastWriteTime = exportedAtUtc;
            var target = await entry.OpenAsync(cancellationToken);
            await using (target.ConfigureAwait(false))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
                {
                    if (read > (maxBytes ?? limits.MaxArchiveBytes) - copiedBytes) throw new DataExportLimitExceededException();
                    await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    copiedBytes += read;
                }
            }
        }

        await sink.DrainAsync(cancellationToken);
        return copiedBytes;
    }

    private static async Task WriteJsonAsync(ZipArchive archive, AsyncDrainStream sink, string name, DateTimeOffset exportedAtUtc, Func<Utf8JsonWriter, Task> write, CancellationToken cancellationToken)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = exportedAtUtc;
        var stream = await entry.OpenAsync(cancellationToken);
        await using (stream.ConfigureAwait(false))
        {
            var writer = new Utf8JsonWriter(stream, JsonOptions);
            await using (writer.ConfigureAwait(false))
            {
                await write(writer);
                await writer.FlushAsync(cancellationToken);
            }
        }

        await sink.DrainAsync(cancellationToken);
    }

    private static async Task WriteTextAsync(ZipArchive archive, AsyncDrainStream sink, string name, string content, DateTimeOffset exportedAtUtc, CancellationToken cancellationToken)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = exportedAtUtc;
        var stream = await entry.OpenAsync(cancellationToken);
        await using (stream.ConfigureAwait(false))
        {
            await stream.WriteAsync(Utf8NoBom.GetBytes(content), cancellationToken);
        }

        await sink.DrainAsync(cancellationToken);
    }

    private static void WritePurchase(Utf8JsonWriter writer, DataExportPurchase purchase)
    {
        writer.WriteStartObject();
        writer.WriteNumber("id", purchase.Id);
        WriteNullableNumber(writer, "linkId", purchase.ItemId);
        writer.WriteString("purchaseDate", purchase.PurchaseDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        writer.WriteString("productName", purchase.ProductName);
        if (purchase.Amount is { } amount)
        {
            writer.WriteNumber("amount", amount);
        }
        else
        {
            writer.WriteNull("amount");
        }

        WriteNullableString(writer, "currencyCode", purchase.CurrencyCode);
        WriteNullableString(writer, "store", purchase.Store);
        WriteNullableString(writer, "variant", purchase.Variant);
        if (purchase.Quantity is { } quantity)
        {
            writer.WriteNumber("quantity", quantity);
        }
        else
        {
            writer.WriteNull("quantity");
        }

        WriteNullableString(writer, "memo", purchase.Memo);
        writer.WriteString("createdAtUtc", purchase.CreatedAtUtc);
        writer.WriteEndObject();
    }

    private static void WriteRepeatPurchase(Utf8JsonWriter writer, DataExportRepeatPurchase repeat)
    {
        writer.WriteStartObject();
        writer.WriteNumber("id", repeat.Id);
        WriteNullableNumber(writer, "linkId", repeat.ItemId);
        writer.WriteString("productName", repeat.ProductName);
        writer.WriteNumber("intervalValue", repeat.IntervalValue);
        writer.WriteString("intervalUnit", repeat.IntervalUnit);
        writer.WriteString("nextPurchaseDate", repeat.NextPurchaseDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        writer.WriteBoolean("reminderEnabled", repeat.IsReminderEnabled);
        writer.WriteNumber("reminderLeadDays", repeat.ReminderLeadDays);
        writer.WriteBoolean("enabled", repeat.IsEnabled);
        writer.WriteString("createdAtUtc", repeat.CreatedAtUtc);
        writer.WriteEndObject();
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null)
        {
            writer.WriteNull(name);
        }
        else
        {
            writer.WriteString(name, value);
        }
    }

    private static void WriteNullableNumber(Utf8JsonWriter writer, string name, long? value)
    {
        if (value is { } number)
        {
            writer.WriteNumber(name, number);
        }
        else
        {
            writer.WriteNull(name);
        }
    }

    private static string ProfilePhotoPath(string blobName) => $"files/profile-photo.{ExtensionOf(blobName)}";

    private static string CollectionPhotoPath(long collectionId, string blobName) =>
        $"files/collection-photos/{collectionId.ToString(CultureInfo.InvariantCulture)}.{ExtensionOf(blobName)}";

    private static string ExtensionFor(string contentType) => contentType.ToLowerInvariant() switch
    {
        "image/webp" => "webp",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        _ => "bin",
    };

    /// <summary>The stored file's extension when it is a plain short one; the storage path itself never appears in the export.</summary>
    private static string ExtensionOf(string blobName)
    {
        var extension = Path.GetExtension(blobName).TrimStart('.').ToLowerInvariant();
        return extension.Length is > 0 and <= 5 && extension.All(char.IsAsciiLetterOrDigit) ? extension : "bin";
    }

    private static string Readme(string preferredLocale)
    {
        var korean = preferredLocale.StartsWith("ko", StringComparison.OrdinalIgnoreCase);
        return korean ? KoreanReadme : EnglishReadme;
    }

    private const string EnglishReadme =
        "Juple data export\r\n"
        + "=================\r\n\r\n"
        + "account.json      Your Juple ID, display name, language, time zone and when the account was created.\r\n"
        + "links.json        Every link you saved: URL, title, memo, saved date, its Collections and its photos.\r\n"
        + "links.csv         The same links as a spreadsheet (UTF-8).\r\n"
        + "collections.json  Collections you own (with their links) and shared Collections you joined (name and your role).\r\n"
        + "comments.json     Comments you wrote in shared Collections.\r\n"
        + "purchases.json    Purchase records you entered (only when there are any).\r\n"
        + "files/            Your profile photo and your Collections' photos.\r\n"
        + "manifest.json     What this file contains, and how many photo files belong to it.\r\n\r\n"
        + "Photos you added to links are in the separate photo files (juple-export-...-photos-N.zip). Unzip them into the same folder:\r\n"
        + "each photo's \"file\" in links.json is its path there.\r\n\r\n"
        + "Links in the trash are included with \"inTrash\": true. Links deleted permanently are no longer stored and are not included.\r\n"
        + "Not included: other people's memos, photos and comments, the names of people in your Collections, passwords and lock settings.\r\n"
        + "In Collections you own, links other members added appear with their URL, title and preview image only.\r\n"
        + "All times are UTC (ISO 8601).\r\n";

    private const string KoreanReadme =
        "Juple 데이터 내보내기\r\n"
        + "=====================\r\n\r\n"
        + "account.json      Juple ID, 표시 이름, 언어, 시간대, 계정을 만든 날짜\r\n"
        + "links.json        저장한 모든 링크: URL, 제목, 메모, 저장일, 속한 컬렉션과 사진\r\n"
        + "links.csv         같은 링크 목록의 스프레드시트 파일(UTF-8)\r\n"
        + "collections.json  내가 만든 컬렉션(링크 포함)과 참여 중인 공유 컬렉션(이름과 내 역할)\r\n"
        + "comments.json     공유 컬렉션에서 내가 쓴 댓글\r\n"
        + "purchases.json    직접 입력한 구매 기록(있을 때만)\r\n"
        + "files/            프로필 사진과 컬렉션 사진\r\n"
        + "manifest.json     이 파일의 구성과 함께 받을 사진 파일 수\r\n\r\n"
        + "링크에 추가한 사진은 별도의 사진 파일(juple-export-...-photos-N.zip)에 있습니다. 같은 폴더에 압축을 풀면\r\n"
        + "links.json의 각 사진 \"file\" 경로와 일치합니다.\r\n\r\n"
        + "휴지통의 링크는 \"inTrash\": true로 포함됩니다. 영구 삭제한 링크는 더 이상 저장되어 있지 않아 포함되지 않습니다.\r\n"
        + "포함되지 않는 것: 다른 사람의 메모·사진·댓글, 컬렉션 참여자의 이름, 비밀번호와 잠금 설정.\r\n"
        + "내가 만든 컬렉션에 다른 참여자가 추가한 링크는 URL, 제목, 미리보기 이미지만 포함됩니다.\r\n"
        + "모든 시각은 UTC(ISO 8601)입니다.\r\n";
}
