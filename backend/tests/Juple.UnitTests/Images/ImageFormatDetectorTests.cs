using Juple.Application.Images;

namespace Juple.UnitTests.Images;

public sealed class ImageFormatDetectorTests
{
    [Fact]
    public void Detect_WhenJpegMagicBytes_ReturnsJpeg()
    {
        byte[] content = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];

        Assert.Equal(ImageFormat.Jpeg, ImageFormatDetector.Detect(content));
    }

    [Fact]
    public void Detect_WhenPngMagicBytes_ReturnsPng()
    {
        byte[] content = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];

        Assert.Equal(ImageFormat.Png, ImageFormatDetector.Detect(content));
    }

    [Fact]
    public void Detect_WhenWebPMagicBytes_ReturnsWebP()
    {
        byte[] content = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

        Assert.Equal(ImageFormat.WebP, ImageFormatDetector.Detect(content));
    }

    [Fact]
    public void Detect_WhenRiffButNotWebP_ReturnsNull()
    {
        // RIFF is also the container format for e.g. .wav/.avi - only WEBP at bytes 8-11 counts.
        byte[] content = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45];

        Assert.Null(ImageFormatDetector.Detect(content));
    }

    [Theory]
    [InlineData(new byte[] { })]
    [InlineData(new byte[] { 0x00 })]
    public void Detect_WhenContentTooShortOrEmpty_ReturnsNull(byte[] content)
    {
        Assert.Null(ImageFormatDetector.Detect(content));
    }

    [Fact]
    public void Detect_WhenPlainTextContent_ReturnsNull()
    {
        var content = "not an image, just text"u8.ToArray();

        Assert.Null(ImageFormatDetector.Detect(content));
    }

    [Fact]
    public void Detect_IgnoresContentAfterSignature_StillDetectsFormat()
    {
        // Proves detection is purely magic-byte based, independent of any claimed extension or
        // Content-Type - the caller never even has a chance to pass those into this method.
        byte[] content = [0xFF, 0xD8, 0xFF, .. new byte[1000]];

        Assert.Equal(ImageFormat.Jpeg, ImageFormatDetector.Detect(content));
    }
}
