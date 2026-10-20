using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Juple.Application.Collections.Locking;
using Juple.Application.DataExport;
using Juple.Domain.Users;

namespace Juple.UnitTests.DataExport;

/// <summary>The data export's pure parts: the photo split, CSV safety, the streamed ZIP and the link/token rules.</summary>
public sealed class DataExportTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 9, 30, 0, TimeSpan.Zero);
    private const long UserId = 42;

    // ---------- photo files ----------

    [Fact]
    public void Photos_AreSplitByBytesAndCount_InIdOrder_AndAnOversizedPhotoGetsAFileOfItsOwn()
    {
        var parts = DataExportImagePartPlanner.Plan([(1, 40), (2, 40), (3, 40), (4, 500), (5, 10), (6, 10), (7, 10)], maxBytes: 100, maxCount: 2);

        Assert.Equal(
            new[] { (1, 1L, 2L, 2, 80L), (2, 3L, 3L, 1, 40L), (3, 4L, 4L, 1, 500L), (4, 5L, 6L, 2, 20L), (5, 7L, 7L, 1, 10L) },
            parts.Select(part => (part.Number, part.FromImageId, part.ThroughImageId, part.ImageCount, part.ByteCount)).ToArray());
        Assert.Empty(DataExportImagePartPlanner.Plan([], 100, 2));
    }

    [Fact]
    public void ThePhotoSplit_IsDeterministic_AndRefusesUnorderedInput()
    {
        (long, long)[] photos = [(10, 5), (11, 5), (12, 5)];
        Assert.Equal(DataExportImagePartPlanner.Plan(photos, 10, 10), DataExportImagePartPlanner.Plan(photos, 10, 10));
        Assert.Throws<ArgumentException>(() => DataExportImagePartPlanner.Plan([(2, 1), (1, 1)], 10, 10));
    }

    // ---------- CSV ----------

    [Theory]
    [InlineData("plain", "\"plain\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("=HYPERLINK(\"x\")", "\"\t=HYPERLINK(\"\"x\"\")\"")]
    [InlineData("+1", "\"\t+1\"")]
    [InlineData("-1", "\"\t-1\"")]
    [InlineData("@SUM(A1)", "\"\t@SUM(A1)\"")]
    [InlineData("\n=1+1", "\"\t\n=1+1\"")]
    [InlineData("  ＝1+1", "\"\t  ＝1+1\"")]
    [InlineData("a,b\r\nc", "\"a,b\r\nc\"")]
    [InlineData(null, "\"\"")]
    public void CsvFields_AreQuoted_AndNeverRunAsAFormula(string? value, string expected)
    {
        Assert.Equal(expected, DataExportArchiveWriter.Csv(value));
    }

    // ---------- the streamed ZIP ----------

    [Fact]
    public async Task TheDataFile_IsWrittenWithAsynchronousWritesOnly_AndContainsTheOwnersDataAndNothingPrivateOfOthers()
    {
        var reader = new FakeReader();
        var files = new FakeFiles();
        var writer = new DataExportArchiveWriter(reader, files, new FixedTime(Now));
        var output = new AsyncOnlyStream();

        await writer.WriteDataAsync(UserId, [new DataExportImagePart(1, 100, 100, 1, 3)], output);

        using var zip = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        Assert.Equal(
            ["README.txt", "account.json", "collections.json", "comments.json", "files/collection-photos/7.webp", "files/profile-photo.webp", "links.csv", "links.json", "manifest.json"],
            zip.Entries.Select(entry => entry.FullName).Order(StringComparer.Ordinal).ToArray());

        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        var link = links.RootElement.GetProperty("links").EnumerateArray().Single();
        Assert.Equal("https://example.test/mine", link.GetProperty("url").GetString());
        Assert.Equal("my memo 메모", link.GetProperty("memo").GetString());
        Assert.True(link.GetProperty("inTrash").GetBoolean());
        var photo = link.GetProperty("photos").EnumerateArray().Single();
        Assert.Equal("photos/5-100.webp", photo.GetProperty("file").GetString());
        Assert.Equal(1, photo.GetProperty("photoFileNumber").GetInt32());
        Assert.Equal("Trips", link.GetProperty("collections").EnumerateArray().Single().GetProperty("name").GetString());

        using var collections = JsonDocument.Parse(Read(zip, "collections.json"));
        var owned = collections.RootElement.GetProperty("ownedCollections").EnumerateArray().Single();
        Assert.Equal(2, owned.GetProperty("members").GetProperty("viewers").GetInt32());
        var entries = owned.GetProperty("links").EnumerateArray().ToArray();
        Assert.Equal(5, entries[0].GetProperty("linkId").GetInt64());
        Assert.False(entries[0].TryGetProperty("url", out _));
        Assert.Equal("https://example.test/theirs", entries[1].GetProperty("url").GetString());
        Assert.False(entries[1].TryGetProperty("linkId", out _));
        Assert.Equal("viewer", collections.RootElement.GetProperty("sharedWithMe").EnumerateArray().Single().GetProperty("myRole").GetString());

        var csv = Read(zip, "links.csv");
        Assert.StartsWith("id,url,title,memo,saved_at_utc,in_trash,collections\r\n", csv.TrimStart('﻿'), StringComparison.Ordinal);
        Assert.Contains("\"\t=1+1\"", csv, StringComparison.Ordinal);

        using var manifest = JsonDocument.Parse(Read(zip, "manifest.json"));
        Assert.Equal("juple-data-export", manifest.RootElement.GetProperty("format").GetString());
        Assert.Equal(0, manifest.RootElement.GetProperty("filesNotFound").GetInt32());

        // Nothing that is not the person's own (or every member's) data, and no storage path, ever reaches the file.
        var everything = string.Join("\n", zip.Entries.Where(entry => entry.FullName.EndsWith(".json", StringComparison.Ordinal) || entry.FullName.EndsWith(".csv", StringComparison.Ordinal)).Select(entry => Read(zip, entry.FullName)));
        Assert.DoesNotContain("items/42/", everything, StringComparison.Ordinal);
        Assert.Equal("ICON", Encoding.UTF8.GetString(ReadBytes(zip, "files/collection-photos/7.webp")));
        Assert.Equal(["items/42/profile/p.webp", "items/42/collections/7/i.webp"], files.Opened);
    }

    [Fact]
    public async Task APhotoFile_CopiesEachPhotoAsIs_AndCountsOnesThatDisappeared()
    {
        var files = new FakeFiles { Missing = { "items/42/5/gone.main.webp" } };
        var writer = new DataExportArchiveWriter(new FakeReader(), files, new FixedTime(Now));
        var output = new AsyncOnlyStream();

        await writer.WriteImagesAsync(UserId, 1, 100, 101, output);

        using var zip = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        Assert.Equal(["manifest-photos-1.json", "photos/5-100.webp"], zip.Entries.Select(entry => entry.FullName).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("PHOTO", Encoding.UTF8.GetString(ReadBytes(zip, "photos/5-100.webp")));
        // Stored, not deflated: photos are already compressed.
        Assert.Equal(zip.GetEntry("photos/5-100.webp")!.Length, zip.GetEntry("photos/5-100.webp")!.CompressedLength);
        using var manifest = JsonDocument.Parse(Read(zip, "manifest-photos-1.json"));
        Assert.Equal(1, manifest.RootElement.GetProperty("photos").GetInt32());
        Assert.Equal(1, manifest.RootElement.GetProperty("filesNotFound").GetInt32());
    }

    [Fact]
    public async Task ALargeAccount_IsStreamedInBoundedChunks_NeverBufferedAsAWhole()
    {
        var writer = new DataExportArchiveWriter(new ManyLinksReader(20_000), new FakeFiles(), new FixedTime(Now));
        var output = new AsyncOnlyStream();

        await writer.WriteDataAsync(UserId, [], output);

        var size = output.ToArray().Length;
        Assert.True(size > 1024 * 1024, $"the test needs a sizeable file, got {size} bytes");
        // Many writes of at most the drain threshold plus one closing block - never one write of the whole entry.
        Assert.True(output.LargestWrite <= 256 * 1024, $"largest single write {output.LargestWrite} bytes");
        Assert.True(output.Writes > size / (256 * 1024));
        using var zip = new ZipArchive(new MemoryStream(output.ToArray()), ZipArchiveMode.Read);
        using var links = JsonDocument.Parse(Read(zip, "links.json"));
        Assert.Equal(20_000, links.RootElement.GetProperty("links").GetArrayLength());
        Assert.Equal(20_001, Read(zip, "links.csv").Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
    }

    // ---------- links and tokens ----------

    [Fact]
    public async Task ActualOutputBytes_AreCapped_AndTheResponseStaysOpen()
    {
        var reader = new ManyLinksReader(20_000);
        var writer = new DataExportArchiveWriter(reader, new FakeFiles(), new FixedTime(Now));
        var service = new DataExportService(new DataExportOptions { Enabled = true, MaxArchiveBytes = 1024 * 1024 }, reader, new FakeLinkStore(), writer, new FixedTime(Now));
        var output = new MemoryStream();
        await Assert.ThrowsAsync<DataExportLimitExceededException>(() => service.WriteAsync(new DataExportDownload(UserId, DataExportPart.Data, null, null, null, "x.zip"), output));
        Assert.InRange(output.Length, 1, 1024 * 1024);
        Assert.True(output.CanWrite);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SlowOrDisconnectedDownloads_CancelAndDisposeTheBlobStream(bool requestAborted)
    {
        var reader = new FakeReader();
        var files = new BlockingFiles();
        var writer = new DataExportArchiveWriter(reader, files, new FixedTime(Now));
        var service = new DataExportService(new DataExportOptions { Enabled = true, MaxDownloadSeconds = 1 }, reader, new FakeLinkStore(), writer, new FixedTime(Now));
        using var disconnected = new CancellationTokenSource();
        if (requestAborted) disconnected.CancelAfter(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.WriteAsync(new DataExportDownload(UserId, DataExportPart.Images, 1, 100, 100, "x.zip"), new MemoryStream(), disconnected.Token));
        Assert.True(files.Source.Disposed);
    }

    [Fact]
    public async Task RecordCeiling_IsCheckedBeforeIssuingTokens()
    {
        var store = new FakeLinkStore();
        var service = Service(new DataExportOptions { Enabled = true, MaxRecords = 1 }, store);
        await Assert.ThrowsAsync<DataExportLimitExceededException>(() => service.CreateLinksAsync(UserId, Now));
        Assert.Empty(store.Links);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("old")]
    [InlineData("future")]
    [InlineData("malformed")]
    [InlineData("recent")]
    public async Task ApiExport_IgnoresTokenIssuedTime_AndRequiresTheVerifiedAuthenticationInstant(string scenario)
    {
        var claims = new List<System.Security.Claims.Claim> { new("iat", Now.ToUnixTimeSeconds().ToString()) };
        if (scenario != "missing") claims.Add(new("auth_time", scenario switch
        {
            "old" => Now.AddMinutes(-6).ToUnixTimeSeconds().ToString(),
            "future" => Now.AddMinutes(2).ToUnixTimeSeconds().ToString(),
            "malformed" => "invalid",
            _ => Now.ToUnixTimeSeconds().ToString(),
        }));
        var controller = new Juple.Api.Controllers.DataExportController(new FakeIdentity(), new FakeCurrentUser(), Service(new DataExportOptions { Enabled = true }, new FakeLinkStore()))
        {
            ControllerContext = new Microsoft.AspNetCore.Mvc.ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(claims, "test")) },
            },
        };
        var result = await controller.CreateLinksAsync(CancellationToken.None);
        if (scenario == "recent") Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(result);
        else Assert.Equal(403, Assert.IsType<Microsoft.AspNetCore.Mvc.ObjectResult>(result).StatusCode);
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(Juple.Api.Controllers.DataExportController), typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute)));
    }

    private sealed class FakeIdentity : Juple.Application.Identity.IExternalIdentityAccessor
    {
        public Juple.Application.Identity.ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FakeCurrentUser : Juple.Application.Users.CurrentUser.ICurrentJupleUserAccessor
    {
        public Task<Juple.Application.Users.CurrentUser.CurrentJupleUser> GetRequiredAsync(Juple.Application.Identity.ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new Juple.Application.Users.CurrentUser.CurrentJupleUser(UserId, "UTC", UserPlan.Free));
    }

    [Fact]
    public void DownloadHandoff_RemovesTheFragmentBeforePosting_AndHasNoTokenInAnyHttpRoute()
    {
        var controller = new Juple.Api.Controllers.DataExportDownloadController(Service(new DataExportOptions { Enabled = true }, new FakeLinkStore()), Microsoft.Extensions.Logging.Abstractions.NullLogger<Juple.Api.Controllers.DataExportDownloadController>.Instance)
        {
            ControllerContext = new Microsoft.AspNetCore.Mvc.ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext() },
        };
        var page = Assert.IsType<Microsoft.AspNetCore.Mvc.ContentResult>(controller.DownloadPage());
        Assert.Contains("location.hash.slice(1)", page.Content, StringComparison.Ordinal);
        Assert.Contains("history.replaceState", page.Content, StringComparison.Ordinal);
        Assert.True(page.Content!.IndexOf("history.replaceState", StringComparison.Ordinal) < page.Content.IndexOf("form.submit", StringComparison.Ordinal));
        Assert.DoesNotContain("<script src", page.Content, StringComparison.Ordinal);
        Assert.Contains("sha256-", controller.Response.Headers["Content-Security-Policy"].ToString(), StringComparison.Ordinal);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
        Assert.Equal("no-referrer", controller.Response.Headers["Referrer-Policy"]);
        Assert.EndsWith("#", Juple.Api.Controllers.DataExportController.DownloadPathPrefix, StringComparison.Ordinal);
        Assert.NotNull(typeof(Juple.Api.Controllers.DataExportDownloadController).GetMethod("DownloadAsync")!.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.HttpPostAttribute), false).SingleOrDefault());
    }

    [Fact]
    public async Task Disabled_EverythingRefuses_AndADownloadTokenResolvesToNothing()
    {
        var store = new FakeLinkStore();
        var service = Service(new DataExportOptions { Enabled = false }, store);

        await Assert.ThrowsAsync<DataExportDisabledException>(() => service.GetSummaryAsync(UserId));
        await Assert.ThrowsAsync<DataExportDisabledException>(() => service.CreateLinksAsync(UserId, Now));
        Assert.Null(await service.OpenDownloadAsync(Base64UrlToken()));
        Assert.Equal(0, store.Claims);
    }

    [Fact]
    public async Task Links_NeedARecentSignIn()
    {
        var service = Service(new DataExportOptions { Enabled = true }, new FakeLinkStore());
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() => service.CreateLinksAsync(UserId, null));
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() => service.CreateLinksAsync(UserId, Now - RecentAuthentication.MaxAge - TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task OneRequest_CreatesALinkForTheDataFileAndEachPhotoFile_StoringOnlyTokenHashes()
    {
        var store = new FakeLinkStore();
        var service = Service(new DataExportOptions { Enabled = true, MaxImageBytesPerPart = 1024 * 1024, MaxImagesPerPart = 1 }, store);

        var created = await service.CreateLinksAsync(UserId, Now.AddMinutes(-1));

        Assert.Equal([DataExportPart.Data, DataExportPart.Images, DataExportPart.Images], created.Select(link => link.Part).ToArray());
        Assert.Equal(["juple-export-20261020.zip", "juple-export-20261020-photos-1.zip", "juple-export-20261020-photos-2.zip"], created.Select(link => link.FileName).ToArray());
        Assert.All(created, link => Assert.Equal(Now.AddMinutes(15), link.ExpiresAtUtc));
        Assert.Equal(3, store.Links.Count);
        foreach (var (link, row) in created.Zip(store.Links))
        {
            Assert.Equal(43, link.Token.Length);
            Assert.Equal(SHA256.HashData(Convert.FromBase64String(link.Token.Replace('-', '+').Replace('_', '/') + "=")), row.TokenHash);
            Assert.Equal(UserId, row.UserId);
        }

        Assert.Equal((100L, 100L), (store.Links[1].FromImageId!.Value, store.Links[1].ThroughImageId!.Value));
        Assert.Equal((101L, 101L), (store.Links[2].FromImageId!.Value, store.Links[2].ThroughImageId!.Value));
        Assert.Equal(created.Select(link => link.Token).Distinct().Count(), created.Count);
    }

    [Fact]
    public async Task TooManyRequestsInADay_AreRefused()
    {
        var store = new FakeLinkStore { ExportsInLastDay = 10 };
        var service = Service(new DataExportOptions { Enabled = true, MaxExportsPerDay = 10 }, store);
        await Assert.ThrowsAsync<DataExportRateLimitedException>(() => service.CreateLinksAsync(UserId, Now));
        Assert.Empty(store.Links);
    }

    [Fact]
    public async Task ADownload_ResolvesOnlyAWellFormedTokenThatTheStoreClaims_AndTakesTheAccountFromTheStoredLink()
    {
        var store = new FakeLinkStore();
        var service = Service(new DataExportOptions { Enabled = true }, store);
        var created = await service.CreateLinksAsync(UserId, Now);

        foreach (var malformed in new[] { "", "short", new string('A', 44), created[0].Token + "x", created[0].Token.Replace(created[0].Token[0], '*') })
        {
            Assert.Null(await service.OpenDownloadAsync(malformed));
        }

        Assert.Equal(0, store.Claims);
        var download = await service.OpenDownloadAsync(created[1].Token);
        Assert.Equal((UserId, DataExportPart.Images, 1, "juple-export-20261020-photos-1.zip"), (download!.UserId, download.Part, download.ImagePartNumber!.Value, download.FileName));
        Assert.Null(await service.OpenDownloadAsync(Base64UrlToken()));
    }

    [Theory]
    [InlineData(0L, 1000, 15, 1, 10, "MaxImageBytesPerPart")]
    [InlineData(268435456L, 0, 15, 1, 10, "MaxImagesPerPart")]
    [InlineData(268435456L, 1000, 0, 1, 10, "LinkLifetimeMinutes")]
    [InlineData(268435456L, 1000, 16, 1, 10, "LinkLifetimeMinutes")]
    [InlineData(268435456L, 1000, 15, 0, 10, "MaxUsesPerLink")]
    [InlineData(268435456L, 1000, 15, 2, 10, "MaxUsesPerLink")]
    [InlineData(268435456L, 1000, 15, 1, 0, "MaxExportsPerDay")]
    public void InvalidOptions_NameTheSetting(long bytes, int images, int minutes, int uses, int perDay, string setting)
    {
        var options = new DataExportOptions { MaxImageBytesPerPart = bytes, MaxImagesPerPart = images, LinkLifetimeMinutes = minutes, MaxUsesPerLink = uses, MaxExportsPerDay = perDay };
        Assert.Contains(setting, options.Validate(), StringComparison.Ordinal);
        Assert.Null(new DataExportOptions().Validate());
        Assert.False(new DataExportOptions().Enabled);
    }

    [Fact]
    public async Task EvenUnvalidatedOptions_CannotIssueALinkForMoreThanFifteenMinutes()
    {
        var store = new FakeLinkStore();
        var service = Service(new DataExportOptions { Enabled = true, LinkLifetimeMinutes = 16 }, store);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateLinksAsync(UserId, Now));
        Assert.Empty(store.Links);
    }

    // ---------- helpers ----------

    private static DataExportService Service(DataExportOptions options, FakeLinkStore store) =>
        new(options, new FakeReader(), store, new DataExportArchiveWriter(new FakeReader(), new FakeFiles(), new FixedTime(Now)), new FixedTime(Now));

    private static string Base64UrlToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Read(ZipArchive zip, string name) => Encoding.UTF8.GetString(ReadBytes(zip, name));

    private static byte[] ReadBytes(ZipArchive zip, string name)
    {
        using var stream = zip.GetEntry(name)!.Open();
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>Like Kestrel's response body: not seekable, and any synchronous write or flush is an error.</summary>
    private sealed class AsyncOnlyStream : Stream
    {
        private readonly MemoryStream inner = new();

        public override bool CanRead => false;

        public override bool CanSeek => false;

        public override bool CanWrite => true;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public byte[] ToArray() => inner.ToArray();

        public int LargestWrite { get; private set; }

        public int Writes { get; private set; }

        private void Count(int size)
        {
            Writes++;
            LargestWrite = Math.Max(LargestWrite, size);
        }

        public override void Flush() => throw new InvalidOperationException("Synchronous operations are disallowed.");

        public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public override void Write(byte[] buffer, int offset, int count) => throw new InvalidOperationException("Synchronous operations are disallowed.");

        public override void Write(ReadOnlySpan<byte> buffer) => throw new InvalidOperationException("Synchronous operations are disallowed.");

        public override void WriteByte(byte value) => throw new InvalidOperationException("Synchronous operations are disallowed.");

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Count(buffer.Length);
            return inner.WriteAsync(buffer, cancellationToken);
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            Count(count);
            return inner.WriteAsync(buffer, offset, count, cancellationToken);
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();
    }

    private sealed class FakeFiles : IDataExportFileSource
    {
        public HashSet<string> Missing { get; } = [];

        public List<string> Opened { get; } = [];

        public Task<Stream?> OpenReadAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Assert.Equal(UserId, userId);
            Opened.Add(blobName);
            if (Missing.Contains(blobName))
            {
                return Task.FromResult<Stream?>(null);
            }

            var content = blobName.Contains("/collections/", StringComparison.Ordinal) ? "ICON" : blobName.Contains("/profile/", StringComparison.Ordinal) ? "PROFILE" : "PHOTO";
            return Task.FromResult<Stream?>(new MemoryStream(Encoding.UTF8.GetBytes(content)));
        }
    }

    private sealed class BlockingFiles : IDataExportFileSource
    {
        public BlockingStream Source { get; } = new();
        public Task<Stream?> OpenReadAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Stream?>(Source);
    }

    private sealed class BlockingStream : Stream
    {
        public bool Disposed { get; private set; }
        public override bool CanRead => true;
        public override bool CanWrite => false;
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }

    private sealed class FakeLinkStore : IDataExportLinkStore
    {
        public List<DataExportLink> Links { get; } = [];

        public int ExportsInLastDay { get; set; }

        public int Claims { get; private set; }

        public Task<int> CountExportsSinceAsync(long userId, DateTimeOffset sinceUtc, CancellationToken cancellationToken = default) => Task.FromResult(ExportsInLastDay);

        public Task AddAsync(IReadOnlyCollection<DataExportLink> links, int maxExportsPerDay, CancellationToken cancellationToken = default)
        {
            Links.AddRange(links);
            return Task.CompletedTask;
        }

        public Task<DataExportLink?> ClaimAsync(byte[] tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Claims++;
            return Task.FromResult(Links.FirstOrDefault(link => link.TokenHash.SequenceEqual(tokenHash) && link.ExpiresAtUtc > nowUtc));
        }
    }

    private sealed class ManyLinksReader(int count) : FakeReader
    {
        public override async IAsyncEnumerable<DataExportItem> ReadItemsAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            for (var index = 1; index <= count; index++)
            {
                // Random memos so compression cannot shrink the file to nothing.
                yield return new DataExportItem(index, $"https://example.test/{index}", $"Title {index}", Convert.ToBase64String(RandomNumberGenerator.GetBytes(60)), null, Now, null, [], []);
            }
        }
    }

    private class FakeReader : IDataExportReader
    {
        public Task<DataExportAccount?> GetAccountAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<DataExportAccount?>(new DataExportAccount("ABCD1234", "나리", "ko-KR", "Asia/Seoul", "KRW", Now.AddYears(-1), "items/42/profile/p.webp"));

        public Task<DataExportCounts> GetCountsAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new DataExportCounts(1, 1, 1, 1, 1, 0, 0, 2, 6));

        public virtual async IAsyncEnumerable<DataExportItem> ReadItemsAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield return new DataExportItem(
                5,
                "https://example.test/mine",
                "=1+1",
                "my memo 메모",
                "https://img.example.test/p.jpg",
                Now.AddDays(-3),
                Now.AddDays(-1),
                [new DataExportItemPhoto(100, "image/webp", 3, 0, Now.AddDays(-3))],
                [new DataExportItemCollection(7, Now.AddDays(-3))]);
        }

        public Task<IReadOnlyList<DataExportOwnedCollection>> GetOwnedCollectionsAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<DataExportOwnedCollection>>(
            [
                new DataExportOwnedCollection(7, "Trips", "plane", "blue", false, true, Now.AddDays(-9), Now.AddDays(-2), "items/42/collections/7/i.webp",
                    new DataExportShare("pub123", true, false, "read"), new DataExportMemberCounts(0, 0, 2)),
            ]);

        public async IAsyncEnumerable<DataExportCollectionEntry> ReadOwnedCollectionEntriesAsync(long userId, long collectionId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield return new DataExportCollectionEntry(collectionId, true, 5, null, null, null, Now.AddDays(-3));
            yield return new DataExportCollectionEntry(collectionId, false, null, "https://example.test/theirs", "Their title", null, Now.AddDays(-2));
        }

        public Task<IReadOnlyList<DataExportMembership>> GetMembershipsAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<DataExportMembership>>([new DataExportMembership(9, "Friends' picks", "viewer", Now.AddDays(-5))]);

        public async IAsyncEnumerable<DataExportComment> ReadCommentsAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield return new DataExportComment(1, 9, 77, "nice", Now.AddDays(-4), false);
        }

        public async IAsyncEnumerable<DataExportPurchase> ReadPurchasesAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield break;
        }

        public async IAsyncEnumerable<DataExportRepeatPurchase> ReadRepeatPurchasesAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield break;
        }

        public async IAsyncEnumerable<DataExportImageRef> ReadImagesAsync(long userId, long? fromImageId, long? throughImageId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            DataExportImageRef[] all =
            [
                new(100, 5, "items/42/5/a.main.webp", "image/webp", 3),
                new(101, 5, "items/42/5/gone.main.webp", "image/webp", 3),
            ];
            foreach (var image in all.Where(image => image.ImageId >= (fromImageId ?? 0) && image.ImageId <= (throughImageId ?? long.MaxValue)))
            {
                yield return image;
            }
        }
    }
}
