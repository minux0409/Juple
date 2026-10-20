using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Juple.Infrastructure.Images;

namespace Juple.UnitTests.Images;

/// <summary>
/// Read URLs are signed for fixed 30-minute UTC windows so every response for the same Blob inside a window carries the identical
/// URL - the platform image caches (Fresco, the iOS URL cache, the browser) key on the exact URL and can then reuse the bytes.
/// </summary>
public sealed class ReadUrlWindowTests
{
    private static DateTimeOffset At(int hour, int minute, int second = 0) => new(2026, 10, 20, hour, minute, second, TimeSpan.Zero);

    [Fact]
    public void EveryMomentOfOneWindow_GetsTheSameValidity_AndTheNextWindowANewOne()
    {
        var first = ItemImageStore.ReadUrlValidity(At(10, 0), null);
        Assert.Equal(first, ItemImageStore.ReadUrlValidity(At(10, 17, 30), null));
        Assert.Equal(first, ItemImageStore.ReadUrlValidity(At(10, 29, 59), null));
        Assert.Equal((At(9, 55), At(10, 45)), first);

        var next = ItemImageStore.ReadUrlValidity(At(10, 30), null);
        Assert.NotEqual(first, next);
        Assert.Equal((At(10, 25), At(11, 15)), next);
    }

    [Theory]
    [InlineData(10, 0, 45)]   // issued at the window start: valid 45 more minutes
    [InlineData(10, 29, 16)]  // issued just before the window ends: still at least 15 minutes
    [InlineData(10, 15, 30)]
    public void AUrlLivesBetween15And45MinutesAfterIssue(int hour, int minute, int expectedMinutes)
    {
        var issued = At(hour, minute);
        var (startsOn, expiresOn) = ItemImageStore.ReadUrlValidity(issued, null);
        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), expiresOn - issued);
        Assert.InRange(expiresOn - issued, TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(45));
        Assert.True(startsOn <= issued); // usable immediately, with clock-skew headroom
    }

    [Fact]
    public void TheSigningKeysExpiryCapsTheUrl_AndAnyTimeZoneMeansTheSameInstant()
    {
        var keyExpiry = At(10, 30);
        Assert.Equal(keyExpiry, ItemImageStore.ReadUrlValidity(At(10, 5), keyExpiry).ExpiresOn);
        Assert.Equal(At(10, 45), ItemImageStore.ReadUrlValidity(At(10, 5), At(12, 0)).ExpiresOn);

        var seoul = new DateTimeOffset(2026, 10, 20, 19, 5, 0, TimeSpan.FromHours(9)); // = 10:05 UTC
        Assert.Equal(ItemImageStore.ReadUrlValidity(At(10, 5), null), ItemImageStore.ReadUrlValidity(seoul, null));
    }

    [Fact]
    public void TheSameWindow_SignsTheIdenticalUrl_ReadOnly_AndAnotherBlobOrWindowDoesNot()
    {
        // Offline: a Shared Key client (a made-up key) signs locally - no network. Production signs with a User Delegation Key the
        // same way, so the same inputs give the same signature there too.
        var container = new BlobServiceClient(new Uri("https://juplecachetest.blob.core.windows.net"), new StorageSharedKeyCredential("juplecachetest", Convert.ToBase64String(new byte[64])))
            .GetBlobContainerClient("item-images");

        Uri Sign(string blobName, DateTimeOffset now)
        {
            var (startsOn, expiresOn) = ItemImageStore.ReadUrlValidity(now, null);
            var builder = new BlobSasBuilder { BlobContainerName = container.Name, BlobName = blobName, Resource = "b", StartsOn = startsOn, ExpiresOn = expiresOn };
            builder.SetPermissions(BlobSasPermissions.Read);
            return container.GetBlobClient(blobName).GenerateSasUri(builder);
        }

        var a = Sign("items/7/1/abc.thumb.webp", At(10, 1));
        Assert.Equal(a, Sign("items/7/1/abc.thumb.webp", At(10, 28)));            // same window: the identical URL
        Assert.NotEqual(a, Sign("items/7/1/abc.thumb.webp", At(10, 31)));         // next window
        Assert.NotEqual(a, Sign("items/7/1/abc.main.webp", At(10, 1)));           // another Blob
        Assert.Contains("sp=r&", a.Query, StringComparison.Ordinal);              // read-only
        Assert.DoesNotContain("sp=rw", a.Query, StringComparison.Ordinal);
    }
}
