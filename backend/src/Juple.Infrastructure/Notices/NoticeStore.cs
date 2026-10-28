using System.Globalization;
using System.Text.Json;
using Juple.Application.Notices;
using Juple.Domain.Admin;
using Juple.Domain.Notices;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;
namespace Juple.Infrastructure.Notices;

/// <summary>No shared cache: publication windows, edits and per-user reads are evaluated from SQL on every request.</summary>
public sealed class NoticeStore(JupleDbContext db) : INoticeStore
{
    private IQueryable<Notice> Visible(NoticePlatforms platform, DateTimeOffset now) => db.Notices.AsNoTracking()
        .Where(n => n.DeletedAtUtc == null && n.Status == NoticeStatus.Published && n.StartsAtUtc <= now
            && (n.EndsAtUtc == null || n.EndsAtUtc > now) && (n.Platforms & platform) != 0);
    private sealed record Cursor(bool Pinned, DateTimeOffset Date, long Id);
    private static Cursor Decode(string cursor) {
        try { return JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(cursor)) ?? throw new FormatException(); }
        catch (Exception e) when (e is FormatException or JsonException) { throw new InvalidNoticeException("cursor", "Invalid notice cursor."); }
    }
    private async Task<NoticeItem> Item(Notice n, long user, string language, CancellationToken ct) {
        var text = n.Translations.FirstOrDefault(t => t.Language == language) ?? n.Translations.Single(t => t.Language == "ko");
        var read = await db.NoticeReads.AsNoTracking().AnyAsync(x => x.UserId == user && x.NoticeId == n.Id && x.ReadVersion >= n.ReadVersion, ct);
        return MakeItem(n, text, read);
    }
    private static NoticeItem MakeItem(Notice n, NoticeTranslation t, bool read) => new(n.Id, t.Language, t.Title,
        t.Body[..Math.Min(t.Body.Length, 160)].Replace('\n', ' '), n.StartsAtUtc, n.IsImportant, n.IsPinned, read, n.ReadVersion);
    public async Task<NoticePage> ListAsync(long userId, NoticePlatforms platform, string language, string? cursor, int limit, DateTimeOffset now, CancellationToken ct) {
        var query = Visible(platform, now);
        if (cursor is not null) {
            var c = Decode(cursor);
            query = query.Where(n => (c.Pinned && !n.IsPinned) || n.IsPinned == c.Pinned && (n.StartsAtUtc < c.Date || n.StartsAtUtc == c.Date && n.Id < c.Id));
        }
        var rows = await query.Include(n => n.Translations.Where(t => t.Language == language || t.Language == "ko")).OrderByDescending(n => n.IsPinned).ThenByDescending(n => n.StartsAtUtc).ThenByDescending(n => n.Id).Take(limit + 1).ToListAsync(ct);
        var more = rows.Count > limit; rows = rows.Take(limit).ToList();
        var ids = rows.Select(n => n.Id).ToArray();
        var reads = await db.NoticeReads.AsNoTracking().Where(x => x.UserId == userId && ids.Contains(x.NoticeId)).ToDictionaryAsync(x => x.NoticeId, x => x.ReadVersion, ct);
        var items = rows.Select(n => MakeItem(n, n.Translations.FirstOrDefault(t => t.Language == language) ?? n.Translations.Single(t => t.Language == "ko"), reads.GetValueOrDefault(n.Id) >= n.ReadVersion)).ToList();
        var last = rows.LastOrDefault();
        return new(items, more && last is not null ? Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Cursor(last.IsPinned, last.StartsAtUtc, last.Id))) : null);
    }
    public async Task<NoticeDetail?> GetAsync(long userId, long id, NoticePlatforms platform, string language, DateTimeOffset now, CancellationToken ct) {
        var n = await Visible(platform, now).Include(x => x.Translations).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (n is null) return null;
        var item = await Item(n, userId, language, ct);
        return new(item, n.Translations.Single(t => t.Language == item.Language).Body, n.OfficialUrl);
    }
    public Task<bool> HasUnreadAsync(long userId, NoticePlatforms platform, DateTimeOffset now, CancellationToken ct) =>
        Visible(platform, now).AnyAsync(n => !db.NoticeReads.Any(read => read.UserId == userId && read.NoticeId == n.Id && read.ReadVersion >= n.ReadVersion), ct);
    public async Task MarkReadAsync(long userId, long id, NoticePlatforms platform, int readVersion, DateTimeOffset now, CancellationToken ct) {
        // One atomic server-filtered upsert. HOLDLOCK + composite unique PK handles simultaneous devices/retries.
        // A stale detail cannot mark a newer explicit read-reset version as read.
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            MERGE notices.NoticeReads WITH (HOLDLOCK) AS target
            USING (SELECT Id FROM notices.Notices WHERE Id={id} AND DeletedAtUtc IS NULL AND Status='Published'
              AND StartsAtUtc<={now} AND (EndsAtUtc IS NULL OR EndsAtUtc>{now}) AND (Platforms & {(int)platform})<>0 AND ReadVersion={readVersion}) AS source
            ON target.UserId={userId} AND target.NoticeId=source.Id
            WHEN MATCHED THEN UPDATE SET ReadVersion={readVersion}, ReadAtUtc={now}
            WHEN NOT MATCHED THEN INSERT (UserId, NoticeId, ReadVersion, ReadAtUtc) VALUES ({userId}, source.Id, {readVersion}, {now});
            """, ct);
        if (changed == 0) {
            if (await Visible(platform, now).AnyAsync(n => n.Id == id, ct)) throw new NoticeConflictException();
            throw new NoticeNotFoundException();
        }
    }
    private static AdminNotice Admin(Notice n)
    {
        var korean = n.Translations.FirstOrDefault(t => t.Language == "ko");
        return new(n.Id, n.Status.ToString(), n.IsImportant, n.IsPinned, (int)n.Platforms,
            n.StartsAtUtc, n.EndsAtUtc, n.OfficialUrl,
            n.Translations.Select(t => new NoticeText(t.Language, t.Title, t.Body, t.Origin ?? (t.Language == "ko" ? NoticeTranslation.OriginSource : NoticeTranslation.OriginManual), t.SourceFingerprint, t.TranslatedAtUtc)).ToList(),
            Convert.ToBase64String(n.Version), n.CreatedAtUtc, n.UpdatedAtUtc, n.ReadVersion)
        { SourceFingerprint = korean is null ? null : NoticeService.SourceFingerprint(korean.Title, korean.Body) };
    }
    public async Task<AdminNoticePage> AdminListAsync(string? search, NoticeStatus? status, long? cursor, int limit, CancellationToken ct) {
        var q = db.Notices.AsNoTracking().Where(n => n.DeletedAtUtc == null);
        if (status is not null) q = q.Where(n => n.Status == status);
        if (!string.IsNullOrWhiteSpace(search)) q = q.Where(n => n.Translations.Any(t => t.Title.Contains(search)));
        if (cursor is not null) q = q.Where(n => n.Id < cursor);
        var rows = await q.OrderByDescending(n => n.Id).Take(limit + 1).Select(n => new AdminNoticeRow(n.Id, n.Translations.Where(t => t.Language == "ko").Select(t => t.Title).First(), n.Status.ToString(), n.IsImportant, n.IsPinned, n.StartsAtUtc, n.EndsAtUtc, n.CreatedAtUtc) { LanguageCount = n.Translations.Count }).ToListAsync(ct);
        var more = rows.Count > limit; rows = rows.Take(limit).ToList();
        return new(rows, more ? rows.Last().Id.ToString(CultureInfo.InvariantCulture) : null);
    }
    public async Task<AdminNotice?> AdminGetAsync(long id, CancellationToken ct) {
        var n = await db.Notices.AsNoTracking().Include(n => n.Translations).SingleOrDefaultAsync(n => n.Id == id && n.DeletedAtUtc == null, ct);
        return n is null ? null : Admin(n);
    }
    private async Task CheckAdmin(long adminId, CancellationToken ct) {
        if (!await db.AdminUsers.AnyAsync(a => a.UserId == adminId && a.IsActive, ct)) throw new UnauthorizedAccessException();
    }
    public async Task<AdminNotice> SaveAsync(long adminId, long? id, NoticeWrite write, DateTimeOffset now, CancellationToken ct) {
        await CheckAdmin(adminId, ct);
        await using var tx = await db.Database.BeginOrJoinTransactionAsync(ct);
        var n = id is null ? new Notice { CreatedAtUtc = now } : await db.Notices.Include(n => n.Translations).SingleOrDefaultAsync(n => n.Id == id && n.DeletedAtUtc == null, ct) ?? throw new NoticeNotFoundException();
        if (id is not null && Convert.ToBase64String(n.Version) != write.Version) throw new NoticeConflictException();
        n.Status = Enum.Parse<NoticeStatus>(write.Status, true); n.IsImportant = write.IsImportant; n.IsPinned = write.IsPinned;
        n.Platforms = (NoticePlatforms)write.Platforms; n.StartsAtUtc = write.StartsAtUtc.ToUniversalTime(); n.EndsAtUtc = write.EndsAtUtc?.ToUniversalTime(); n.OfficialUrl = write.OfficialUrl; n.UpdatedAtUtc = now;
        if (id is not null && write.ResetRead) n.ReadVersion++;
        // Update existing composite-key children in place (avoids remove/add tracking collisions).
        foreach (var old in n.Translations.Where(t => !write.Translations.Any(x => x.Language == t.Language)).ToList()) n.Translations.Remove(old);
        foreach (var text in write.Translations) {
            var translation = n.Translations.SingleOrDefault(t => t.Language == text.Language);
            if (translation is null) { translation = new NoticeTranslation { Language = text.Language }; n.Translations.Add(translation); }
            var origin = text.Language == "ko" ? NoticeTranslation.OriginSource : text.Origin ?? NoticeTranslation.OriginManual;
            if (translation.Title != text.Title || translation.Body != text.Body || translation.Origin != origin || translation.SourceFingerprint != text.SourceFingerprint)
                translation.TranslatedAtUtc = now;
            translation.Title = text.Title; translation.Body = text.Body; translation.Origin = origin;
            translation.SourceFingerprint = text.Language == "ko" ? null : text.SourceFingerprint;
        }
        if (id is null) db.Notices.Add(n);
        else db.Entry(n).Property(x => x.UpdatedAtUtc).IsModified = true; // Translation-only edits must advance the aggregate rowversion, even at the same clock tick.
        try {
            await db.SaveChangesAsync(ct);
            db.AdminAuditLogs.Add(new AdminAuditLog(adminId, id is null ? AdminAuditActions.NoticeCreated : AdminAuditActions.NoticeUpdated, AdminAuditTargets.Notice, n.Id.ToString(CultureInfo.InvariantCulture), $"status={n.Status};readVersion={n.ReadVersion};resetRead={write.ResetRead}", now));
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        } catch (DbUpdateConcurrencyException) { throw new NoticeConflictException(); }
        return Admin(n);
    }
    public async Task DeleteAsync(long adminId, long id, string version, DateTimeOffset now, CancellationToken ct) {
        await CheckAdmin(adminId, ct); await using var tx = await db.Database.BeginOrJoinTransactionAsync(ct);
        var n = await db.Notices.SingleOrDefaultAsync(n => n.Id == id && n.DeletedAtUtc == null, ct) ?? throw new NoticeNotFoundException();
        if (Convert.ToBase64String(n.Version) != version) throw new NoticeConflictException();
        n.DeletedAtUtc = now; n.UpdatedAtUtc = now;
        db.AdminAuditLogs.Add(new AdminAuditLog(adminId, AdminAuditActions.NoticeDeleted, AdminAuditTargets.Notice, id.ToString(CultureInfo.InvariantCulture), "soft-delete", now));
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); } catch (DbUpdateConcurrencyException) { throw new NoticeConflictException(); }
    }
}
