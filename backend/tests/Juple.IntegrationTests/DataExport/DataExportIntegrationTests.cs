using System.IO.Compression;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using System.Text;
using System.Text.Json;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Locking;
using Juple.Application.DataExport;
using Juple.Domain.Collections;
using Juple.Domain.Images;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.DataExport;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.DataExport;

/// <summary>
/// The data export against the real schema and Azurite: the privacy projection lives in SQL (the reader), so it is verified here with
/// an owner, a member of the owner's shared Collection and a stranger - each export must hold only its own person's data.
/// </summary>
public sealed class DataExportIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private readonly List<string> _blobs = [];

    private long _owner;
    private long _member;
    private long _stranger;
    private long _sharedId;
    private long _oldCollectionId;
    private long _memberOwnId;
    private long _ownerItem;
    private long _ownerTrashedItem;
    private long _memberItem;
    private long _ownerPhotoId;
    private byte[] _ownerPhotoBytes = [];

    public async Task InitializeAsync()
    {
        var connectionString = LocalRetentionEnvironment.RequireConnectionString();
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _stranger = await NewUserAsync();

        var collections = new CollectionStore(_db);
        var access = new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
        })), TimeProvider.System);
        var collaboration = new CollectionCollaborationService(access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        var addItem = new AddItemToCollectionService(access, collections, TimeProvider.System);

        _sharedId = (await collections.CreateAsync(_owner, "Trips 여행", "TRIPS 여행", CollectionIcon.Plane, DateTimeOffset.UtcNow)).Id;
        _oldCollectionId = (await collections.CreateAsync(_owner, "Deleted one", "DELETED ONE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _memberOwnId = (await collections.CreateAsync(_member, "Member private", "MEMBER PRIVATE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        _ownerItem = await NewItemAsync(_owner, "https://example.test/owner", "owner memo 메모");
        _ownerTrashedItem = await NewItemAsync(_owner, "https://example.test/owner-trashed", "trashed memo");
        _memberItem = await NewItemAsync(_member, "https://example.test/member", "member secret memo");
        await NewItemAsync(_stranger, "https://example.test/stranger", "stranger secret memo");

        // A real photo on the owner's link (Azurite), and a photo row on the member's link that the owner's export must never touch.
        _ownerPhotoBytes = Encoding.UTF8.GetBytes("RIFF-owner-photo-bytes");
        _ownerPhotoId = await NewPhotoAsync(_owner, _ownerItem, _ownerPhotoBytes);
        await NewPhotoAsync(_member, _memberItem, Encoding.UTF8.GetBytes("RIFF-member-photo"));

        await addItem.AddAsync(_owner, _sharedId, _ownerItem);
        await addItem.AddAsync(_owner, _oldCollectionId, _ownerItem);
        var invitation = await collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member));
        await collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);
        await addItem.AddAsync(_member, _sharedId, _memberItem);
        await addItem.AddAsync(_member, _memberOwnId, _memberItem);

        _db.CollectionItemComments.Add(new CollectionItemComment(_sharedId, _memberItem, _owner, "owner comment", DateTimeOffset.UtcNow));
        _db.CollectionItemComments.Add(new CollectionItemComment(_sharedId, _ownerItem, _member, "member comment", DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();

        (await _db.Items.SingleAsync(item => item.Id == _ownerTrashedItem)).SoftDelete(DateTimeOffset.UtcNow);
        (await _db.Collections.SingleAsync(collection => collection.Id == _oldCollectionId)).SoftDelete(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        if (_db is null) return;
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        var container = TestBlobContainerClientFactory.Create();
        foreach (var blob in _blobs)
        {
            await container.DeleteBlobIfExistsAsync(blob);
        }

        await _db.DisposeAsync();
    }

    [Fact]
    public async Task TheOwnersExport_HoldsOnlyTheOwnersOwnData_AndOtherMembersLinksOnlyAsEveryMemberSeesThem()
    {
        using var zip = await ExportDataAsync(_owner);
        var all = AllText(zip);

        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        var exported = links.RootElement.GetProperty("links").EnumerateArray().ToDictionary(link => link.GetProperty("id").GetInt64());
        Assert.Equal([_ownerItem, _ownerTrashedItem], exported.Keys.Order().ToArray());
        Assert.Equal("owner memo 메모", exported[_ownerItem].GetProperty("memo").GetString());
        Assert.False(exported[_ownerItem].GetProperty("inTrash").GetBoolean());
        Assert.True(exported[_ownerTrashedItem].GetProperty("inTrash").GetBoolean());
        // The soft-deleted Collection is not listed among the link's Collections.
        Assert.Equal([_sharedId], exported[_ownerItem].GetProperty("collections").EnumerateArray().Select(entry => entry.GetProperty("id").GetInt64()).ToArray());
        Assert.Equal($"photos/{_ownerItem}-{_ownerPhotoId}.webp", exported[_ownerItem].GetProperty("photos").EnumerateArray().Single().GetProperty("file").GetString());

        using var collections = JsonDocument.Parse(Read(zip, "collections.json"));
        var owned = collections.RootElement.GetProperty("ownedCollections").EnumerateArray().Single();
        Assert.Equal(_sharedId, owned.GetProperty("id").GetInt64());
        Assert.Equal(1, owned.GetProperty("members").GetProperty("contributors").GetInt32());
        var entries = owned.GetProperty("links").EnumerateArray().ToArray();
        Assert.Equal(2, entries.Length);
        var theirs = entries.Single(entry => !entry.GetProperty("mine").GetBoolean());
        Assert.Equal("https://example.test/member", theirs.GetProperty("url").GetString());
        Assert.False(theirs.TryGetProperty("linkId", out _));
        Assert.Empty(collections.RootElement.GetProperty("sharedWithMe").EnumerateArray());

        Assert.Contains("owner comment", all, StringComparison.Ordinal);
        Assert.DoesNotContain("member comment", all, StringComparison.Ordinal);
        Assert.DoesNotContain("member secret memo", all, StringComparison.Ordinal);
        Assert.DoesNotContain("stranger", all, StringComparison.Ordinal);
        Assert.DoesNotContain("Deleted one", all, StringComparison.Ordinal);
        Assert.DoesNotContain("items/", all, StringComparison.Ordinal);
        Assert.DoesNotContain(await JupleIdOfAsync(_member), all, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheMembersExport_HasTheirMembershipAndTheirOwnLink_ButNoneOfTheOwnersData()
    {
        using var zip = await ExportDataAsync(_member);
        var all = AllText(zip);

        using var collections = JsonDocument.Parse(Read(zip, "collections.json"));
        var shared = collections.RootElement.GetProperty("sharedWithMe").EnumerateArray().Single();
        Assert.Equal((_sharedId, "Trips 여행", "contributor"), (shared.GetProperty("id").GetInt64(), shared.GetProperty("name").GetString(), shared.GetProperty("myRole").GetString()));
        // The owner's Collection is not exported as content of the member: no link list of it at all.
        Assert.False(shared.TryGetProperty("links", out _));

        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        var link = links.RootElement.GetProperty("links").EnumerateArray().Single();
        Assert.Equal(_memberItem, link.GetProperty("id").GetInt64());
        Assert.Equal("member secret memo", link.GetProperty("memo").GetString());
        Assert.Equal(new[] { _sharedId, _memberOwnId }.Order().ToArray(), link.GetProperty("collections").EnumerateArray().Select(entry => entry.GetProperty("id").GetInt64()).Order().ToArray());

        Assert.Contains("member comment", all, StringComparison.Ordinal);
        Assert.DoesNotContain("owner comment", all, StringComparison.Ordinal);
        Assert.DoesNotContain("owner memo", all, StringComparison.Ordinal);
        Assert.DoesNotContain("https://example.test/owner", all, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ThePhotoFile_CopiesOnlyThePersonsOwnPhotos_ByteForByte()
    {
        var service = Service(new DataExportOptions { Enabled = true });
        var summary = await service.GetSummaryAsync(_owner);
        var part = Assert.Single(summary.ImageParts);
        Assert.Equal((1, _ownerPhotoBytes.Length), (summary.Counts.Photos, (int)summary.Counts.PhotoBytes));

        var output = new MemoryStream();
        await service.WriteAsync(new DataExportDownload(_owner, DataExportPart.Images, 1, part.FromImageId, part.ThroughImageId, "x.zip"), output);

        using var zip = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        var photo = Assert.Single(zip.Entries, entry => entry.FullName.StartsWith("photos/", StringComparison.Ordinal));
        Assert.Equal($"photos/{_ownerItem}-{_ownerPhotoId}.webp", photo.FullName);
        Assert.Equal(_ownerPhotoBytes, ReadBytes(zip, photo.FullName));

        // Even a range that spans the member's photo id yields only the owner's photos.
        var wide = new MemoryStream();
        await service.WriteAsync(new DataExportDownload(_owner, DataExportPart.Images, 1, 1, long.MaxValue, "x.zip"), wide);
        using var wideZip = new ZipArchive(new MemoryStream(wide.ToArray()), ZipArchiveMode.Read);
        Assert.Single(wideZip.Entries, entry => entry.FullName.StartsWith("photos/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ALink_WorksOnceWithinFifteenMinutes_ForItsStoredOwner_AndUnusedLinksGoWithTheAccount()
    {
        var service = Service(new DataExportOptions { Enabled = true });
        var created = await service.CreateLinksAsync(_owner, DateTimeOffset.UtcNow);
        Assert.Equal(2, created.Count);

        var first = await service.OpenDownloadAsync(created[0].Token);
        Assert.Equal((_owner, DataExportPart.Data), (first!.UserId, first.Part));
        Assert.Null(await service.OpenDownloadAsync(created[0].Token));

        // Only the hash is stored.
        var tokenBytes = Encoding.ASCII.GetBytes(created[1].Token);
        Assert.False(await _db.DataExportLinks.AnyAsync(link => link.TokenHash == tokenBytes));

        // An expired link is worthless.
        await _db.DataExportLinks.Where(link => link.UserId == _owner).ExecuteUpdateAsync(setters => setters.SetProperty(link => link.ExpiresAtUtc, DateTimeOffset.UtcNow.AddSeconds(-1)).SetProperty(link => link.CreatedAtUtc, DateTimeOffset.UtcNow.AddMinutes(-20)));
        Assert.Null(await service.OpenDownloadAsync(created[1].Token));

        // Fresh, unconsumed links are revoked by deletion, independent of expiry or prior consumption.
        var unused = await service.CreateLinksAsync(_owner, DateTimeOffset.UtcNow);
        Assert.All(await _db.DataExportLinks.Where(link => link.UserId == _owner && link.ExpiresAtUtc > DateTimeOffset.UtcNow).ToListAsync(), link => Assert.Equal(0, link.UseCount));
        var otherAccount = await service.CreateLinksAsync(_member, DateTimeOffset.UtcNow);
        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_owner);
        Assert.False(await _db.DataExportLinks.AnyAsync(link => link.UserId == _owner));
        Assert.Null(await service.OpenDownloadAsync(created[0].Token));
        foreach (var link in unused) Assert.Null(await service.OpenDownloadAsync(link.Token));
        Assert.NotNull(await service.OpenDownloadAsync(otherAccount[0].Token));
    }

    [Fact]
    public async Task LegacyLongLivedGrant_IsRejectedAtFifteenMinutes_EvenIfItsStoredExpiryIsLater()
    {
        var service = Service(new DataExportOptions { Enabled = true });
        var created = await service.CreateLinksAsync(_owner, DateTimeOffset.UtcNow);
        var now = DateTimeOffset.UtcNow;
        await _db.DataExportLinks.Where(link => link.UserId == _owner).ExecuteUpdateAsync(setters => setters
            .SetProperty(link => link.CreatedAtUtc, now.AddMinutes(-15))
            .SetProperty(link => link.ExpiresAtUtc, now.AddMinutes(30)));
        Assert.Null(await service.OpenDownloadAsync(created[0].Token));
        Assert.Equal(0, await _db.DataExportLinks.Where(link => link.UserId == _owner).SumAsync(link => link.UseCount));
    }

    [Fact]
    public async Task TheDailyLimit_CountsExportRequests()
    {
        var service = Service(new DataExportOptions { Enabled = true, MaxExportsPerDay = 2 });
        await service.CreateLinksAsync(_member, DateTimeOffset.UtcNow);
        await service.CreateLinksAsync(_member, DateTimeOffset.UtcNow);
        await Assert.ThrowsAsync<DataExportRateLimitedException>(() => service.CreateLinksAsync(_member, DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() => service.CreateLinksAsync(_stranger, DateTimeOffset.UtcNow.AddMinutes(-10)));
    }

    // ---------- helpers ----------

    [Fact]
    public async Task EmptyAndLockedAccounts_ProduceValidArchives_AndRevokedMembershipsRevealNoCollectionMetadata()
    {
        var empty = await NewUserAsync();
        using (var zip = await ExportDataAsync(empty))
        {
            using var json = JsonDocument.Parse(Read(zip, "links.json"));
            Assert.Empty(json.RootElement.GetProperty("links").EnumerateArray());
            Assert.Equal(zip.Entries.Count, zip.Entries.Select(entry => entry.FullName).Distinct().Count());
        }
        var collection = await _db.Collections.SingleAsync(entry => entry.Id == _sharedId);
        collection.Lock(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        using (var locked = await ExportDataAsync(_owner))
            Assert.Contains("owner memo 메모", AllText(locked), StringComparison.Ordinal);

        await new CollectionCollaborationStore(_db).RemoveCollaboratorAsync(_sharedId, _member);
        using var revoked = await ExportDataAsync(_member);
        Assert.DoesNotContain("Trips 여행", AllText(revoked), StringComparison.Ordinal);
        Assert.DoesNotContain("owner memo", AllText(revoked), StringComparison.Ordinal);
        var foreignEntries = new List<DataExportCollectionEntry>();
        await foreach (var entry in new DataExportReader(_db).ReadOwnedCollectionEntriesAsync(_stranger, _sharedId)) foreignEntries.Add(entry);
        Assert.Empty(foreignEntries);
    }

    [Fact]
    public async Task ConcurrentClaimsAndIssuance_RespectTheDatabaseLimits()
    {
        // The DB guarantee holds even if options were constructed without configuration validation.
        var options = new DataExportOptions { Enabled = true, MaxUsesPerLink = 10, MaxExportsPerDay = 2 };
        var created = await Service(options).CreateLinksAsync(_owner, DateTimeOffset.UtcNow);
        var claims = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var db = NewContext();
            return await Service(options, db).OpenDownloadAsync(created[0].Token);
        }));
        Assert.Single(claims, claim => claim is not null);
        Assert.Equal(1, await _db.DataExportLinks.Where(link => link.UserId == _owner).SumAsync(link => link.UseCount));

        var issuance = await Task.WhenAll(Enumerable.Range(0, 5).Select(async _ =>
        {
            await using var db = NewContext();
            try { await Service(options, db).CreateLinksAsync(_owner, DateTimeOffset.UtcNow); return true; }
            catch (DataExportRateLimitedException) { return false; }
        }));
        Assert.Single(issuance, accepted => accepted);
        Assert.Equal(2, await _db.DataExportLinks.CountAsync(link => link.UserId == _owner && link.Part == DataExportPart.Data));
    }

    [Fact]
    public async Task ThousandsOfLinks_KeepRelationshipsAndZipContents_AndDeletedPhotosAreNotCopied()
    {
        var savedAt = DateTimeOffset.UtcNow;
        for (var number = 0; number < 1_200; number++)
            _db.Items.Add(new Juple.Domain.Items.Item(_owner, $"https://example.test/bulk/{number}", savedAt));
        await _db.SaveChangesAsync();
        using var zip = await ExportDataAsync(_owner);
        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        Assert.Equal(1_202, links.RootElement.GetProperty("links").GetArrayLength());
        Assert.Equal(1_203, Read(zip, "links.csv").Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
        Assert.All(zip.Entries, entry => Assert.DoesNotContain("..", entry.FullName, StringComparison.Ordinal));
        foreach (var entry in zip.Entries) Assert.NotEmpty(ReadBytes(zip, entry.FullName));

        var service = Service(new DataExportOptions { Enabled = true });
        var part = Assert.Single((await service.GetSummaryAsync(_owner)).ImageParts);
        await TestBlobContainerClientFactory.Create().DeleteBlobIfExistsAsync(_blobs[0]);
        var output = new MemoryStream();
        await service.WriteAsync(new DataExportDownload(_owner, DataExportPart.Images, 1, part.FromImageId, part.ThroughImageId, "x.zip"), output);
        using var photos = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        Assert.Single(photos.Entries);
        Assert.Equal(1, JsonDocument.Parse(Read(photos, "manifest-photos-1.json")).RootElement.GetProperty("filesNotFound").GetInt32());
    }

    private static JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")).Options);

    [Fact]
    public async Task BlobOwnershipAndActualByteLimits_AreEnforcedEvenWithIncorrectStoredLengths()
    {
        var source = new DataExportBlobFileSource(TestBlobContainerClientFactory.Create());
        await Assert.ThrowsAsync<InvalidOperationException>(() => source.OpenReadAsync(_owner, _blobs[1]));
        var blob = $"items/{_owner}/{_ownerItem}/{Guid.NewGuid():N}.webp";
        await TestBlobContainerClientFactory.Create().GetBlobClient(blob).UploadAsync(new BinaryData(new byte[1024 * 1024 + 1]));
        _blobs.Add(blob);
        var row = new ItemImage(_ownerItem, blob, "image/webp", 1, 2, DateTimeOffset.UtcNow);
        _db.ItemImages.Add(row);
        await _db.SaveChangesAsync();
        var service = Service(new DataExportOptions { Enabled = true, MaxImageBytesPerPart = 1024 * 1024 });
        await Assert.ThrowsAsync<DataExportLimitExceededException>(() => service.WriteAsync(new DataExportDownload(_owner, DataExportPart.Images, 1, row.Id, row.Id, "x.zip"), new MemoryStream()));
    }

    [Fact]
    public async Task IssuedPhotoFileNumbersStayStable_WhenPhotosAreDeletedOrAddedBeforeDownloading()
    {
        var secondId = await NewPhotoAsync(_owner, _ownerItem, Encoding.UTF8.GetBytes("second"));
        var service = Service(new DataExportOptions { Enabled = true, MaxImagesPerPart = 1 });
        var issued = await service.CreateLinksAsync(_owner, DateTimeOffset.UtcNow);
        Assert.Equal(3, issued.Count);
        await _db.ItemImages.Where(image => image.Id == _ownerPhotoId).ExecuteDeleteAsync();
        var thirdId = await NewPhotoAsync(_owner, _ownerItem, Encoding.UTF8.GetBytes("later"));
        var download = await service.OpenDownloadAsync(issued[0].Token);
        var output = new MemoryStream();
        await service.WriteAsync(download!, output);
        using var zip = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        var link = links.RootElement.GetProperty("links").EnumerateArray().Single(entry => entry.GetProperty("id").GetInt64() == _ownerItem);
        var photo = Assert.Single(link.GetProperty("photos").EnumerateArray());
        Assert.Equal(2, photo.GetProperty("photoFileNumber").GetInt32());
        Assert.Contains($"-{secondId}.", photo.GetProperty("file").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain($"-{thirdId}.", Read(zip, "links.json"), StringComparison.Ordinal);
    }

    private DataExportService Service(DataExportOptions options, JupleDbContext? context = null)
    {
        var db = context ?? _db;
        var reader = new DataExportReader(db);
        return new DataExportService(options, reader, new DataExportLinkStore(db), new DataExportArchiveWriter(reader, new DataExportBlobFileSource(TestBlobContainerClientFactory.Create()), TimeProvider.System, options), TimeProvider.System);
    }

    private async Task<ZipArchive> ExportDataAsync(long userId)
    {
        var output = new MemoryStream();
        await Service(new DataExportOptions { Enabled = true }).WriteAsync(new DataExportDownload(userId, DataExportPart.Data, null, null, null, "x.zip"), output);
        return new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
    }

    private static string AllText(ZipArchive zip) =>
        string.Join("\n", zip.Entries.Where(entry => entry.FullName.EndsWith(".json", StringComparison.Ordinal) || entry.FullName.EndsWith(".csv", StringComparison.Ordinal)).Select(entry => Read(zip, entry.FullName)));

    private static string Read(ZipArchive zip, string name) => Encoding.UTF8.GetString(ReadBytes(zip, name));

    private static byte[] ReadBytes(ZipArchive zip, string name)
    {
        using var stream = zip.GetEntry(name)!.Open();
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url, string memo)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        var item = await _db.Items.SingleAsync(entry => entry.Id == saved.Entry.Id);
        item.UpdateDetails("Title of " + url, memo);
        await _db.SaveChangesAsync();
        return item.Id;
    }

    private async Task<long> NewPhotoAsync(long userId, long itemId, byte[] content)
    {
        var blobName = $"items/{userId}/{itemId}/{Guid.NewGuid():N}.main.webp";
        await TestBlobContainerClientFactory.Create().GetBlobClient(blobName).UploadAsync(new BinaryData(content));
        _blobs.Add(blobName);
        var image = new ItemImage(itemId, blobName, "image/webp", content.Length, 0, DateTimeOffset.UtcNow);
        _db.ItemImages.Add(image);
        await _db.SaveChangesAsync();
        return image.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();
}
