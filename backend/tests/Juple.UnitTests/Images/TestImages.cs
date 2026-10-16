using SkiaSharp;

namespace Juple.UnitTests.Images;

/// <summary>Real, decodable test images (and synthetic EXIF) for the upload normalizers - never a user's photo or a real location.</summary>
internal static class TestImages
{
    /// <summary>A marker carried in the synthetic EXIF ImageDescription; finding it in an output means metadata survived.</summary>
    public const string MetadataMarker = "JUPLE-SYNTHETIC-GPS";

    public static byte[] Create(SKEncodedImageFormat format, int width, int height)
    {
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(new SKColor(242, 244, 248));
            using var paint = new SKPaint { Color = new SKColor(18, 80, 180), IsAntialias = true };
            canvas.DrawRect(0, 0, Math.Max(1, width / 2f), height, paint);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, 92) ?? throw new InvalidOperationException("Test image encode failed.");
        return data.ToArray();
    }

    public static void AssertWebP(byte[] content, int width, int height)
    {
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(content, 0, 4));
        Assert.Equal("WEBP", System.Text.Encoding.ASCII.GetString(content, 8, 4));
        using var bitmap = SKBitmap.Decode(content);
        Assert.NotNull(bitmap);
        Assert.Equal((width, height), (bitmap.Width, bitmap.Height));
    }

    /// <summary>Inserts an EXIF APP1 with only an Orientation tag right after the JPEG SOI.</summary>
    public static byte[] AddExifOrientation(byte[] jpeg, ushort orientation)
    {
        byte[] app1 =
        [
            0xFF, 0xE1, 0x00, 0x22,
            0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
            0x00, 0x01,
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
            (byte)(orientation >> 8), (byte)orientation, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ];
        return [.. jpeg[..2], .. app1, .. jpeg[2..]];
    }

    /// <summary>
    /// Inserts an EXIF APP1 (big-endian TIFF) with Orientation, an ImageDescription carrying <see cref="MetadataMarker"/>, and a GPS
    /// IFD (GPSLatitudeRef "N", GPSLatitude 1/1 2/1 3/1) - a synthetic location, not a real one.
    /// </summary>
    public static byte[] AddExifWithGps(byte[] jpeg, ushort orientation)
    {
        var description = System.Text.Encoding.ASCII.GetBytes(MetadataMarker + "\0");
        const int ifd0 = 8, ifd0Size = 2 + (3 * 12) + 4, gpsIfd = ifd0 + ifd0Size, gpsIfdSize = 2 + (2 * 12) + 4;
        const int latitude = gpsIfd + gpsIfdSize, descriptionOffset = latitude + 24;
        var tiff = new List<byte> { 0x4D, 0x4D, 0x00, 0x2A };
        AddUInt32(tiff, ifd0);
        AddUInt16(tiff, 3);
        AddEntry(tiff, 0x010E, 2, (uint)description.Length, descriptionOffset); // ImageDescription (ASCII, at offset)
        AddUInt16(tiff, 0x0112); AddUInt16(tiff, 3); AddUInt32(tiff, 1); AddUInt16(tiff, orientation); AddUInt16(tiff, 0); // Orientation
        AddEntry(tiff, 0x8825, 4, 1, gpsIfd); // GPSInfo IFD pointer
        AddUInt32(tiff, 0);
        AddUInt16(tiff, 2);
        AddUInt16(tiff, 0x0001); AddUInt16(tiff, 2); AddUInt32(tiff, 2); tiff.AddRange([(byte)'N', 0, 0, 0]); // GPSLatitudeRef
        AddEntry(tiff, 0x0002, 5, 3, latitude); // GPSLatitude (3 RATIONALs, at offset)
        AddUInt32(tiff, 0);
        foreach (var value in new uint[] { 1, 1, 2, 1, 3, 1 })
        {
            AddUInt32(tiff, value);
        }
        tiff.AddRange(description);

        var payload = new List<byte>("Exif\0\0"u8.ToArray());
        payload.AddRange(tiff);
        var length = payload.Count + 2;
        byte[] header = [0xFF, 0xE1, (byte)(length >> 8), (byte)length];
        return [.. jpeg[..2], .. header, .. payload, .. jpeg[2..]];
    }

    public static bool ContainsAscii(byte[] content, string value) =>
        System.Text.Encoding.ASCII.GetString(content).Contains(value, StringComparison.Ordinal);

    private static void AddEntry(List<byte> tiff, ushort tag, ushort type, uint count, int offset)
    {
        AddUInt16(tiff, tag);
        AddUInt16(tiff, type);
        AddUInt32(tiff, count);
        AddUInt32(tiff, (uint)offset);
    }

    private static void AddUInt16(List<byte> bytes, ushort value) => bytes.AddRange([(byte)(value >> 8), (byte)value]);

    private static void AddUInt32(List<byte> bytes, uint value) =>
        bytes.AddRange([(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value]);
}
