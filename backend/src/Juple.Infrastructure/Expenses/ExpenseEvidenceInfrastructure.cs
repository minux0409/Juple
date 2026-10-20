using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Juple.Application.Expenses;
using SkiaSharp;

namespace Juple.Infrastructure.Expenses;

public sealed class ClamAvExpenseScanner(ExpenseOptions options) : IExpenseEvidenceScanner
{
    public async Task ScanAsync(ReadOnlyMemory<byte> bytes, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(options.ClamAvHost)) Unavailable();
        var type = ExpenseEvidenceService.DetectType(bytes.Span);
        if (type.StartsWith("image/", StringComparison.Ordinal))
        {
            using var data = SKData.CreateCopy(bytes.Span);
            using var codec = SKCodec.Create(data);
            if (codec is null || codec.Info.Width <= 0 || codec.Info.Height <= 0 || (long)codec.Info.Width * codec.Info.Height > 16_000_000)
                throw new ExpenseRequestException("evidenceType", "Image evidence is invalid or exceeds 16 megapixels.");
            using var decoded = SKBitmap.Decode(codec);
            if (decoded is null) throw new ExpenseRequestException("evidenceType", "Image evidence cannot be decoded.");
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(20)); ct = deadline.Token;
        try
        {
            var addresses = await Dns.GetHostAddressesAsync(options.ClamAvHost!, ct);
            var address = addresses.FirstOrDefault(PrivateAddress) ?? throw new ExpenseRequestException("evidenceScannerUnavailable", "Use a private malware-scanner endpoint.");
            using var client = new TcpClient(address.AddressFamily);
            await client.ConnectAsync(address, options.ClamAvPort, ct);
            await using var stream = client.GetStream();
            await stream.WriteAsync("zINSTREAM\0"u8.ToArray(), ct);
            var header = new byte[4];
            for (var offset = 0; offset < bytes.Length; offset += 64 * 1024)
            {
                var count = Math.Min(64 * 1024, bytes.Length - offset); BinaryPrimitives.WriteInt32BigEndian(header, count);
                await stream.WriteAsync(header, ct); await stream.WriteAsync(bytes.Slice(offset, count), ct);
            }
            await stream.WriteAsync(new byte[4], ct); await stream.FlushAsync(ct);
            using var reply = new MemoryStream(); var buffer = new byte[256];
            while (reply.Length < 4096)
            {
                var read = await stream.ReadAsync(buffer, ct); if (read == 0) break;
                reply.Write(buffer, 0, read); if (buffer.AsSpan(0, read).Contains((byte)0)) break;
            }
            var verdict = Encoding.UTF8.GetString(reply.ToArray()).TrimEnd('\0', '\r', '\n');
            if (verdict == "stream: OK") return;
            if (verdict.EndsWith(" FOUND", StringComparison.Ordinal)) throw new ExpenseRequestException("evidenceMalware", "Evidence was rejected by the malware scanner.");
            Unavailable();
        }
        catch (ExpenseRequestException) { throw; }
        catch (Exception e) when (e is SocketException or IOException or OperationCanceledException) { Unavailable(); }
    }
    private static bool PrivateAddress(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        var b = ip.GetAddressBytes();
        return b.Length == 4 ? b[0] == 10 || b[0] == 172 && b[1] is >= 16 and <= 31 || b[0] == 192 && b[1] == 168
            : (b[0] & 0xfe) == 0xfc;
    }
    private static void Unavailable() => throw new ExpenseRequestException("evidenceScannerUnavailable", "Evidence scanning is unavailable. No file was accepted.");
}

/// <summary>Private original evidence. No public URL/SAS and no customer image container reuse.</summary>
public sealed class ExpenseEvidenceFiles(BlobServiceClient storage) : IExpenseEvidenceFiles
{
    private BlobContainerClient Container => storage.GetBlobContainerClient("expense-evidence");
    private static void Check(string name)
    { if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^expenses/[0-9]+/[a-f0-9]{32}\\.(pdf|png|jpg)$")) throw new ExpenseNotFoundException(); }
    public async Task PutAsync(string name, ReadOnlyMemory<byte> bytes, string contentType, CancellationToken ct)
    {
        Check(name); var container = Container;
        await container.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: ct);
        var properties = await container.GetPropertiesAsync(cancellationToken: ct);
        if (properties.Value.PublicAccess != PublicAccessType.None) throw new ExpenseRequestException("evidenceStorageUnsafe", "Evidence storage must be private.");
        await using var input = new MemoryStream(bytes.ToArray(), false);
        await container.GetBlobClient(name).UploadAsync(input, new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType, CacheControl = "no-store" } }, ct);
    }
    public async Task<Stream> OpenAsync(string name, CancellationToken ct)
    { Check(name); return await Container.GetBlobClient(name).OpenReadAsync(cancellationToken: ct); }
    public async Task DeleteAsync(string name, CancellationToken ct)
    { Check(name); await Container.GetBlobClient(name).DeleteIfExistsAsync(cancellationToken: ct); }
}
