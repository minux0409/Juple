namespace Juple.Application.DataExport;

/// <summary>
/// Sits between <see cref="System.IO.Compression.ZipArchive"/> and the HTTP response. The ZIP code still writes a few bytes
/// synchronously when an entry or the archive is closed (the final compressed block, the data descriptor, the central directory) - and
/// the web server refuses any synchronous write on a response. Synchronous writes are therefore only buffered here, and the writer
/// drains them asynchronously right after each entry and at the end (<see cref="DrainAsync"/>). Asynchronous writes go out as soon as
/// the buffer is large, so memory stays bounded by one entry's closing bytes plus <see cref="DrainThreshold"/>.
/// </summary>
internal sealed class AsyncDrainStream(Stream output, CancellationToken lifetimeToken = default) : Stream
{
    public const int DrainThreshold = 64 * 1024;

    private readonly MemoryStream pending = new();

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => throw new NotSupportedException();

    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

    /// <summary>Bytes waiting to be written to the response (for tests and diagnostics).</summary>
    public long PendingBytes => pending.Length;

    public override void Write(byte[] buffer, int offset, int count) { lifetimeToken.ThrowIfCancellationRequested(); pending.Write(buffer, offset, count); }

    public override void Write(ReadOnlySpan<byte> buffer) { lifetimeToken.ThrowIfCancellationRequested(); pending.Write(buffer); }

    public override void WriteByte(byte value) { lifetimeToken.ThrowIfCancellationRequested(); pending.WriteByte(value); }

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        lifetimeToken.ThrowIfCancellationRequested();
        pending.Write(buffer.Span);
        if (pending.Length >= DrainThreshold)
        {
            await DrainAsync(cancellationToken);
        }
    }

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <summary>Nothing goes out synchronously: the next <see cref="DrainAsync"/> sends what is buffered.</summary>
    public override void Flush()
    {
    }

    public override async Task FlushAsync(CancellationToken cancellationToken)
    {
        if (!cancellationToken.CanBeCanceled) cancellationToken = lifetimeToken;
        await DrainAsync(cancellationToken);
        await output.FlushAsync(cancellationToken);
    }

    public async Task DrainAsync(CancellationToken cancellationToken)
    {
        if (!cancellationToken.CanBeCanceled) cancellationToken = lifetimeToken;
        cancellationToken.ThrowIfCancellationRequested();
        if (pending.Length == 0)
        {
            return;
        }

        await output.WriteAsync(pending.GetBuffer().AsMemory(0, (int)pending.Length), cancellationToken);
        pending.SetLength(0);
    }

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            pending.Dispose();
        }

        base.Dispose(disposing);
    }
}
