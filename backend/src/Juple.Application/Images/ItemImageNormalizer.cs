using SkiaSharp;

namespace Juple.Application.Images;

/// <summary>
/// Decodes and re-encodes an Item photo once at upload time. The signed-in Web detail layout shows
/// at most about 520 CSS px and list/grid images are 60-210 CSS px; at the common 2x DPR, a 1600 px
/// main image and a 512 px list thumbnail leave useful headroom without retaining camera-sized
/// pixels. Quality 88/84 keeps small text and screenshots legible while still removing EXIF and
/// substantially reducing ordinary camera photos.
/// </summary>
public static class ItemImageNormalizer
{
    public const int MainMaxEdge = 1600;
    public const int ThumbnailMaxEdge = 512;
    public const int MainQuality = 88;
    public const int ThumbnailQuality = 84;

    // Profile photos and Collection icon photos are shown at most about 104 CSS px (Web profile editor; avatars and icon tiles are
    // 22-72 px). 512 px - the Mobile picker's own size - covers that at up to ~5x density without keeping camera-sized pixels.
    public const int SmallImageMaxEdge = 512;
    public const int SmallImageQuality = 86;

    // Bounds are checked before pixel decode. The API runs in a 0.5 GiB container and some codecs
    // (notably PNG) cannot subsample during decode, so 32 MP caps one RGBA surface near 128 MiB while
    // still accepting ordinary 12-24 MP phone output. Higher-resolution camera modes must be reduced
    // by the client before upload instead of risking a compressed pixel-bomb allocation here.
    public const int MaxInputEdge = 8_000;
    public const long MaxInputPixels = 32_000_000;

    public static NormalizedItemImage Normalize(byte[] content)
    {
        using var oriented = DecodeOriented(content, MainMaxEdge);
        using var main = ResizeWithin(oriented, MainMaxEdge);
        using var thumbnail = ResizeWithin(main, ThumbnailMaxEdge);

        return new NormalizedItemImage(
            EncodeWebP(main, MainQuality),
            main.Width,
            main.Height,
            EncodeWebP(thumbnail, ThumbnailQuality),
            thumbnail.Width,
            thumbnail.Height);
    }

    /// <summary>
    /// One small photo (a profile photo, a Collection icon photo): the same validation, orientation and metadata stripping as an
    /// Item photo, re-encoded once as WebP with its longest edge at most <paramref name="maxEdge"/> (the aspect ratio is kept; the
    /// clients' cover-fit framing is unchanged). Throws InvalidItemImageException for an invalid, corrupt or oversized image.
    /// </summary>
    public static NormalizedImage NormalizeSingle(byte[] content, int maxEdge, int quality)
    {
        using var oriented = DecodeOriented(content, maxEdge);
        using var resized = ResizeWithin(oriented, maxEdge);
        return new NormalizedImage(EncodeWebP(resized, quality), resized.Width, resized.Height);
    }

    /// <summary>
    /// Validates the declared dimensions BEFORE any pixel is allocated, decodes at the smallest codec-supported size that still
    /// covers <paramref name="targetEdge"/>, and applies the EXIF orientation. The returned bitmap carries pixels only - no EXIF,
    /// GPS or other metadata survives the later re-encode.
    /// </summary>
    private static SKBitmap DecodeOriented(byte[] content, int targetEdge)
    {
        using var data = SKData.CreateCopy(content);
        using var codec = SKCodec.Create(data) ?? throw InvalidOrCorrupt();
        var sourceInfo = codec.Info;
        if (sourceInfo.Width <= 0 || sourceInfo.Height <= 0
            || sourceInfo.Width > MaxInputEdge || sourceInfo.Height > MaxInputEdge
            || (long)sourceInfo.Width * sourceInfo.Height > MaxInputPixels)
        {
            throw new InvalidItemImageException(
                "file",
                $"Image dimensions must be at most {MaxInputEdge}px per edge and {MaxInputPixels / 1_000_000} megapixels.");
        }

        var decodedDimensions = ChooseDecodeSize(codec, targetEdge);
        var decodeInfo = new SKImageInfo(
            decodedDimensions.Width,
            decodedDimensions.Height,
            SKColorType.Rgba8888,
            SKAlphaType.Premul,
            SKColorSpace.CreateSrgb());
        using var decoded = new SKBitmap(decodeInfo);
        var decodeResult = codec.GetPixels(decodeInfo, decoded.GetPixels());
        // Never keep a partially decoded upload: IncompleteInput is a truncated/corrupt file,
        // even when Skia managed to paint some rows before reaching the missing bytes.
        if (decodeResult is not SKCodecResult.Success)
        {
            throw InvalidOrCorrupt();
        }

        return ApplyOrientation(decoded, codec.EncodedOrigin);
    }

    /// <summary>
    /// JPEG/WebP codecs can decode at a reduced size (JPEG in 1/8 steps), avoiding a full-resolution allocation. The codec rounds
    /// to a size it supports, which can fall BELOW the target (3840 px asked for 1600 gives 3/8 = 1440); then the next larger
    /// supported size is used so the final resize, not the decoder, decides the output size. PNG reports the source size.
    /// </summary>
    private static SKSizeI ChooseDecodeSize(SKCodec codec, int targetEdge)
    {
        var source = codec.Info.Size;
        var longEdge = Math.Max(source.Width, source.Height);
        if (longEdge <= targetEdge)
        {
            return source;
        }

        var desired = (float)targetEdge / longEdge;
        var dimensions = codec.GetScaledDimensions(desired);
        if (Math.Max(dimensions.Width, dimensions.Height) >= targetEdge)
        {
            return dimensions;
        }

        for (var eighths = 1; eighths < 8; eighths++)
        {
            var scale = eighths / 8f;
            if (scale <= desired)
            {
                continue;
            }

            var candidate = codec.GetScaledDimensions(scale);
            if (Math.Max(candidate.Width, candidate.Height) >= targetEdge)
            {
                return candidate;
            }
        }

        return source;
    }

    private static SKBitmap ApplyOrientation(SKBitmap source, SKEncodedOrigin origin)
    {
        var swapsAxes = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var result = new SKBitmap(
            swapsAxes ? source.Height : source.Width,
            swapsAxes ? source.Width : source.Height,
            SKColorType.Rgba8888,
            SKAlphaType.Premul,
            SKColorSpace.CreateSrgb());
        using var canvas = new SKCanvas(result);
        switch (origin)
        {
            case SKEncodedOrigin.TopRight:
                canvas.Scale(-1, 1);
                canvas.Translate(-source.Width, 0);
                break;
            case SKEncodedOrigin.BottomRight:
                canvas.RotateDegrees(180, result.Width / 2f, result.Height / 2f);
                break;
            case SKEncodedOrigin.BottomLeft:
                canvas.Scale(1, -1);
                canvas.Translate(0, -source.Height);
                break;
            case SKEncodedOrigin.LeftTop:
                canvas.RotateDegrees(90);
                canvas.Scale(1, -1);
                break;
            case SKEncodedOrigin.RightTop:
                canvas.Translate(result.Width, 0);
                canvas.RotateDegrees(90);
                break;
            case SKEncodedOrigin.RightBottom:
                canvas.Translate(result.Width, result.Height);
                canvas.RotateDegrees(90);
                canvas.Scale(-1, 1);
                break;
            case SKEncodedOrigin.LeftBottom:
                canvas.Translate(0, result.Height);
                canvas.RotateDegrees(-90);
                break;
        }
        canvas.DrawBitmap(source, 0, 0, new SKSamplingOptions(SKFilterMode.Linear), paint: null);
        canvas.Flush();
        return result;
    }

    private static SKBitmap ResizeWithin(SKBitmap source, int maxEdge)
    {
        var scale = Math.Min(1d, (double)maxEdge / Math.Max(source.Width, source.Height));
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        var result = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul, SKColorSpace.CreateSrgb());
        using var canvas = new SKCanvas(result);
        canvas.Clear(SKColors.Transparent);
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawBitmap(source, new SKRect(0, 0, width, height), new SKSamplingOptions(SKCubicResampler.Mitchell), paint);
        canvas.Flush();
        return result;
    }

    private static byte[] EncodeWebP(SKBitmap bitmap, int quality)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Webp, quality)
            ?? throw new InvalidItemImageException("file", "The image could not be encoded.");
        return encoded.ToArray();
    }

    private static InvalidItemImageException InvalidOrCorrupt() =>
        new("file", "The image is invalid or corrupt.");
}
