namespace Juple.Application.DataExport;

/// <summary>
/// Splits the person's photos (ordered by id) into numbered files of at most <c>maxBytes</c> and <c>maxCount</c> each, so one download
/// stays bounded however many photos there are. A single photo larger than <c>maxBytes</c> gets a file of its own. Pure and
/// deterministic: the same photos always give the same parts.
/// </summary>
public static class DataExportImagePartPlanner
{
    public static IReadOnlyList<DataExportImagePart> Plan(IEnumerable<(long ImageId, long ByteLength)> imagesOrderedById, long maxBytes, int maxCount)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxBytes, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxCount, 1);

        var parts = new List<DataExportImagePart>();
        long? from = null;
        long through = 0;
        long previous = long.MinValue;
        var count = 0;
        long bytes = 0;
        foreach (var (imageId, byteLength) in imagesOrderedById)
        {
            if (imageId <= previous)
            {
                throw new ArgumentException("Photos must be ordered by ascending id.", nameof(imagesOrderedById));
            }

            previous = imageId;
            var size = Math.Max(0, byteLength);
            if (from is not null && (count >= maxCount || bytes + size > maxBytes))
            {
                parts.Add(new DataExportImagePart(parts.Count + 1, from.Value, through, count, bytes));
                from = null;
            }

            if (from is null)
            {
                from = imageId;
                count = 0;
                bytes = 0;
            }

            through = imageId;
            count++;
            bytes += size;
        }

        if (from is not null)
        {
            parts.Add(new DataExportImagePart(parts.Count + 1, from.Value, through, count, bytes));
        }

        return parts;
    }
}
