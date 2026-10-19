using System.Globalization;
using Juple.Application.Admin;
using Juple.Domain.Admin;
using Juple.Domain.Support;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Admin;

public sealed class AdminAccessStore(JupleDbContext dbContext) : IAdminAccessStore
{
    public Task<AdminAccess?> FindActiveAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.AdminUsers
            .AsNoTracking()
            .Where(admin => admin.UserId == userId && admin.IsActive)
            .Select(admin => new AdminAccess(admin.UserId, admin.Role))
            .SingleOrDefaultAsync(cancellationToken);
}

/// <summary>
/// Live SQL aggregates (COUNT / EXISTS) - one small query per number, nothing materialized. At the current scale these are cheap
/// (indexed or tiny tables); a daily aggregate table can replace them later behind the same AdminDashboardSummary contract.
/// </summary>
public sealed class AdminDashboardStore(JupleDbContext dbContext) : IAdminDashboardStore
{
    public async Task<AdminDashboardSummary> GetSummaryAsync(DateTimeOffset todayStartUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var sevenDayStartUtc = todayStartUtc.AddDays(-6);
        var users = dbContext.Users.AsNoTracking();
        var totalUsers = await users.CountAsync(cancellationToken);
        var newUsersToday = await users.CountAsync(user => user.CreatedAtUtc >= todayStartUtc, cancellationToken);
        var newUsersLast7Days = await users.CountAsync(user => user.CreatedAtUtc >= sevenDayStartUtc, cancellationToken);

        var items = dbContext.Items.AsNoTracking();
        var totalLinks = await items.CountAsync(item => item.DeletedAtUtc == null, cancellationToken);
        var linksSavedToday = await items.CountAsync(item => item.SavedAtUtc >= todayStartUtc, cancellationToken);

        var collections = dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null);
        var totalCollections = await collections.CountAsync(cancellationToken);
        var sharedCollections = await collections.CountAsync(
            collection =>
                dbContext.CollectionCollaborators.Any(member => member.CollectionId == collection.Id)
                || dbContext.CollectionShares.Any(share => share.CollectionId == collection.Id && share.IsActive),
            cancellationToken);

        var openInquiries = await dbContext.SupportInquiries.AsNoTracking().CountAsync(
            inquiry => inquiry.Status == SupportInquiryStatus.Pending || inquiry.Status == SupportInquiryStatus.InProgress,
            cancellationToken);

        return new AdminDashboardSummary(
            todayStartUtc,
            nowUtc,
            totalUsers,
            newUsersToday,
            newUsersLast7Days,
            totalLinks,
            linksSavedToday,
            totalCollections,
            sharedCollections,
            openInquiries);
    }
}

public sealed class AdminUserDirectoryStore(JupleDbContext dbContext) : IAdminUserDirectoryStore
{
    /// <summary>One query: the page of users with their counts as correlated subqueries (indexed by UserId) - no N+1.</summary>
    public async Task<AdminUserPage> ListAsync(string? exactJupleId, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var users = dbContext.Users.AsNoTracking();
        if (exactJupleId is not null)
        {
            users = users.Where(user => user.PublicCode == exactJupleId);
        }

        if (cursor is { } before)
        {
            users = users.Where(user => user.Id < before);
        }

        var rows = await users
            .OrderByDescending(user => user.Id)
            .Take(limit + 1)
            .Select(user => new AdminUserListItem(
                user.Id,
                user.PublicCode,
                user.DisplayName,
                user.CreatedAtUtc,
                user.PreferredLocale,
                user.AcceptedTermsVersion != null,
                dbContext.Items.Count(item => item.UserId == user.Id && item.DeletedAtUtc == null),
                dbContext.Collections.Count(collection => collection.UserId == user.Id && collection.DeletedAtUtc == null)))
            .ToListAsync(cancellationToken);

        var page = rows.Take(limit).ToList();
        return new AdminUserPage(page, rows.Count > limit ? page[^1].UserId : null);
    }
}

public sealed class AdminSupportInquiryStore(JupleDbContext dbContext) : IAdminSupportInquiryStore
{
    private const int PreviewLength = 120;
    private const int HistoryLimit = 50;

    public async Task<AdminInquiryPage> ListAsync(SupportInquiryStatus? status, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var inquiries = dbContext.SupportInquiries.AsNoTracking();
        if (status is { } filter)
        {
            inquiries = inquiries.Where(inquiry => inquiry.Status == filter);
        }

        if (cursor is { } before)
        {
            inquiries = inquiries.Where(inquiry => inquiry.Id < before);
        }

        var rows = await (
                from inquiry in inquiries
                join user in dbContext.Users on inquiry.UserId equals user.Id into owners
                from owner in owners.DefaultIfEmpty()
                orderby inquiry.Id descending
                select new
                {
                    inquiry.Id,
                    inquiry.Status,
                    inquiry.Type,
                    UserId = owner == null ? (long?)null : owner.Id,
                    JupleId = owner == null ? null : owner.PublicCode,
                    DisplayName = owner == null ? null : owner.DisplayName,
                    Preview = inquiry.Content.Substring(0, PreviewLength),
                    inquiry.Platform,
                    inquiry.CreatedAtUtc,
                    inquiry.UpdatedAtUtc,
                    inquiry.AnsweredAtUtc,
                })
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var page = rows.Take(limit)
            .Select(row => new AdminInquiryListItem(
                row.Id,
                row.Status.ToString(),
                row.Type.ToString(),
                row.UserId is { } userId ? new AdminInquiryPerson(userId, row.JupleId!, row.DisplayName) : null,
                row.Preview,
                row.Platform,
                row.CreatedAtUtc,
                row.UpdatedAtUtc,
                row.AnsweredAtUtc))
            .ToList();
        return new AdminInquiryPage(page, rows.Count > limit ? page[^1].InquiryId : null);
    }

    public async Task<AdminInquiryDetail?> GetAsync(long inquiryId, CancellationToken cancellationToken = default)
    {
        var row = await (
                from inquiry in dbContext.SupportInquiries.AsNoTracking()
                join user in dbContext.Users on inquiry.UserId equals user.Id into owners
                from owner in owners.DefaultIfEmpty()
                where inquiry.Id == inquiryId
                select new
                {
                    Inquiry = inquiry,
                    UserId = owner == null ? (long?)null : owner.Id,
                    JupleId = owner == null ? null : owner.PublicCode,
                    DisplayName = owner == null ? null : owner.DisplayName,
                })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return null;
        }

        var targetId = inquiryId.ToString(CultureInfo.InvariantCulture);
        var history = await (
                from log in dbContext.AdminAuditLogs.AsNoTracking()
                join user in dbContext.Users on log.AdminUserId equals user.Id into admins
                from admin in admins.DefaultIfEmpty()
                where log.TargetType == AdminAuditTargets.SupportInquiry && log.TargetId == targetId
                orderby log.Id descending
                select new AdminAuditEntry(log.AdminUserId, admin == null ? null : admin.PublicCode, log.Action, log.Detail, log.CreatedAtUtc))
            .Take(HistoryLimit)
            .ToListAsync(cancellationToken);

        var found = row.Inquiry;
        return new AdminInquiryDetail(
            found.Id,
            found.Status.ToString(),
            found.Type.ToString(),
            row.UserId is { } userId ? new AdminInquiryPerson(userId, row.JupleId!, row.DisplayName) : null,
            found.Content,
            found.Answer,
            found.CreatedAtUtc,
            found.UpdatedAtUtc,
            found.AnsweredAtUtc,
            new AdminInquiryDiagnostics(found.AppVersion, found.BuildNumber, found.Platform, found.OsVersion, found.DeviceModel, found.Locale),
            history);
    }

    public async Task<bool> ChangeStatusAsync(long inquiryId, SupportInquiryStatus status, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var inquiry = await dbContext.SupportInquiries.FirstOrDefaultAsync(entry => entry.Id == inquiryId, cancellationToken);
        if (inquiry is null)
        {
            return false;
        }

        var previous = inquiry.Status;
        if (!inquiry.ChangeUnansweredStatus(status, nowUtc))
        {
            return true;
        }

        // The change and its audit record are saved together: SaveChanges is one transaction, so neither can exist alone.
        dbContext.AdminAuditLogs.Add(new AdminAuditLog(
            adminUserId,
            AdminAuditActions.SupportInquiryStatusChanged,
            AdminAuditTargets.SupportInquiry,
            inquiryId.ToString(CultureInfo.InvariantCulture),
            $"{previous}->{status}",
            nowUtc));
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> AnswerAsync(long inquiryId, string answer, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var inquiry = await dbContext.SupportInquiries.FirstOrDefaultAsync(entry => entry.Id == inquiryId, cancellationToken);
        if (inquiry is null)
        {
            return false;
        }

        var previous = inquiry.Status;
        inquiry.RecordAnswer(answer, nowUtc);
        // The audit detail records the transition and the answer's size - never the answer text itself.
        dbContext.AdminAuditLogs.Add(new AdminAuditLog(
            adminUserId,
            AdminAuditActions.SupportInquiryAnswered,
            AdminAuditTargets.SupportInquiry,
            inquiryId.ToString(CultureInfo.InvariantCulture),
            $"{previous}->{SupportInquiryStatus.Answered} ({answer.Length} chars)",
            nowUtc));
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }
}
