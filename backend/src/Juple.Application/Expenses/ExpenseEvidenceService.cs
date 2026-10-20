using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Juple.Domain.Expenses;

namespace Juple.Application.Expenses;

public sealed class ExpenseEvidenceService(ExpenseService expenses, IExpenseStore store, IExpenseEvidenceScanner scanner,
    IExpenseEvidenceFiles files, TimeProvider time)
{
    public async Task<ExpenseAttachmentInfo> UploadAsync(long actor, long expenseId, Guid requestId, string fileName, Stream input, CancellationToken ct)
    {
        await expenses.RequireAdminAsync(actor, ct);
        if (requestId == Guid.Empty) ExpenseRules.Fail("An upload request ID is required.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(60));
        ct = deadline.Token;
        using var copy = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int read;
        while ((read = await input.ReadAsync(buffer, ct)) > 0)
        {
            if (copy.Length + read > ExpenseOptions.MaxAttachmentBytes) throw new ExpenseRequestException("evidenceTooLarge", "Evidence is limited to 10 MiB.");
            await copy.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        var bytes = copy.ToArray();
        var contentType = DetectType(bytes);
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (contentType == "application/pdf" && extension != ".pdf" || contentType == "image/png" && extension != ".png" || contentType == "image/jpeg" && extension is not (".jpg" or ".jpeg"))
            ExpenseRules.Fail("The file extension and contents disagree.");
        var safeName = Regex.Replace(fileName, @"[^\p{L}\p{N} ._()-]", "_");
        if (safeName.Length > 120) safeName = safeName[..100] + extension;
        await scanner.ScanAsync(bytes, ct); // Fail closed; never substitute a fake clean result when scanning is unavailable.
        await expenses.RequireAdminAsync(actor, ct);
        var attachment = await store.BeginAttachmentAsync(actor, expenseId, requestId, safeName, contentType,
            Convert.ToHexString(SHA256.HashData(bytes)), bytes.Length, ct);
        if (attachment.State == ExpenseAttachmentState.Available) return Info(attachment);
        try
        {
            await files.PutAsync(attachment.BlobName, bytes, contentType, ct);
            await store.CompleteAttachmentAsync(actor, attachment.Id, ct);
            return Info(attachment);
        }
        catch
        {
            // The persisted Pending row tracks the private blob even if the process dies here. It is never downloadable.
            // A later cleanup pass removes abandoned uploads; do not turn a failed upload into an available attachment.
            throw;
        }
    }
    public async Task<(ExpenseAttachmentInfo Info, Stream Content)> DownloadAsync(long actor, long expenseId, long attachmentId, CancellationToken ct)
    {
        await expenses.RequireAdminAsync(actor, ct);
        var row = await store.GetAttachmentAsync(expenseId, attachmentId, ct);
        return (Info(row), await files.OpenAsync(row.BlobName, ct));
    }
    public async Task DeleteAsync(long actor, long expenseId, long attachmentId, CancellationToken ct)
    {
        await expenses.RequireAdminAsync(actor, ct);
        var row = await store.DeleteAttachmentAsync(actor, expenseId, attachmentId, ct); // revoke first, even when Blob is unavailable
        await files.DeleteAsync(row.BlobName, ct);
        await store.MarkAttachmentDeletedAsync(row.Id, ct);
    }
    public async Task<int> CleanupAsync(long? actor, CancellationToken ct)
    {
        if (actor is { } admin) await expenses.RequireAdminAsync(admin, ct);
        var rows = await store.PendingCleanupAsync(time.GetUtcNow().AddHours(-1), ct);
        var count = 0;
        foreach (var row in rows)
        {
            await files.DeleteAsync(row.BlobName, ct);
            await store.MarkAttachmentDeletedAsync(row.Id, ct); count++;
        }
        return count;
    }
    public static string DetectType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        if (bytes.Length >= 5 && bytes[..5].SequenceEqual("%PDF-"u8))
        {
            if (Encoding.Latin1.GetString(bytes).Contains("/Encrypt", StringComparison.Ordinal))
                throw new ExpenseRequestException("evidenceEncrypted", "Encrypted evidence cannot be scanned.");
            return "application/pdf";
        }
        throw new ExpenseRequestException("evidenceType", "Only PDF, PNG and JPEG evidence is accepted.");
    }
    private static ExpenseAttachmentInfo Info(ExpenseAttachment row) => new(row.Id, row.FileName, row.ContentType, row.Bytes, row.CreatedAtUtc);
}
