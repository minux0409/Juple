namespace Juple.Application.DataExport;

/// <summary>Caps bytes actually written, including archive headers, even when stored Blob lengths are stale. Leaves the response open.</summary>
internal sealed class DataExportLimitedStream(Stream output, long maxBytes) : Stream
{
    private long written;
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => written;
    public override long Position { get => written; set => throw new NotSupportedException(); }
    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (buffer.Length > maxBytes - written) throw new DataExportLimitExceededException();
        cancellationToken.ThrowIfCancellationRequested();
        await output.WriteAsync(buffer, cancellationToken);
        written += buffer.Length;
    }
    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException("Use asynchronous writes.");
    public override void Flush() => throw new NotSupportedException("Use asynchronous flush.");
    public override Task FlushAsync(CancellationToken cancellationToken) => output.FlushAsync(cancellationToken);
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
}
