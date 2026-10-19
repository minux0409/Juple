using Juple.Application.Support;
using Juple.Domain.Support;
using Juple.Domain.Users;

namespace Juple.Application.Admin;

/// <summary>
/// The Admin Web's operations. Every method receives the acting admin's internal UserId from the authorization layer (the Admin
/// policy already proved an active grant) - never from the request. Inputs are validated here; storage and the audit record are
/// the stores' job.
/// </summary>
public interface IAdminService
{
    Task<AdminDashboardSummary> GetDashboardSummaryAsync(DateTimeOffset? todayStartUtc, CancellationToken cancellationToken = default);

    Task<AdminUserPage> ListUsersAsync(string? jupleId, long? cursor, int? limit, CancellationToken cancellationToken = default);

    Task<AdminInquiryPage> ListInquiriesAsync(string? status, long? cursor, int? limit, CancellationToken cancellationToken = default);

    Task<AdminInquiryDetail> GetInquiryAsync(long inquiryId, CancellationToken cancellationToken = default);

    Task<AdminInquiryDetail> ChangeInquiryStatusAsync(long adminUserId, long inquiryId, string? status, CancellationToken cancellationToken = default);

    Task<AdminInquiryDetail> AnswerInquiryAsync(long adminUserId, long inquiryId, string? answer, CancellationToken cancellationToken = default);
}

public sealed class AdminService(
    IAdminDashboardStore dashboardStore,
    IAdminUserDirectoryStore userDirectoryStore,
    IAdminSupportInquiryStore inquiryStore,
    TimeProvider timeProvider) : IAdminService
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;

    /// <summary>"Today" may start at most a day and a half away from now - a client clock or time zone, never an arbitrary range.</summary>
    private static readonly TimeSpan MaxTodayStartSkew = TimeSpan.FromHours(36);

    public Task<AdminDashboardSummary> GetDashboardSummaryAsync(DateTimeOffset? todayStartUtc, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var start = todayStartUtc?.ToUniversalTime() ?? new DateTimeOffset(nowUtc.UtcDateTime.Date, TimeSpan.Zero);
        if (start > nowUtc || nowUtc - start > MaxTodayStartSkew)
        {
            throw new InvalidAdminRequestException("todayStartUtc", "todayStartUtc must be the start of the current day (within 36 hours before now).");
        }

        return dashboardStore.GetSummaryAsync(start, nowUtc, cancellationToken);
    }

    public Task<AdminUserPage> ListUsersAsync(string? jupleId, long? cursor, int? limit, CancellationToken cancellationToken = default)
    {
        string? exact = null;
        if (!string.IsNullOrWhiteSpace(jupleId))
        {
            // The apps display a Juple ID as "@K7MP-4Q8N": the "@" is presentation only.
            if (!UserPublicCode.TryNormalize(jupleId.Trim().TrimStart('@'), out var normalized))
            {
                throw new InvalidAdminRequestException("jupleId", "jupleId is not a valid Juple ID.");
            }

            exact = normalized;
        }

        return userDirectoryStore.ListAsync(exact, cursor, ResolvePageSize(limit), cancellationToken);
    }

    public Task<AdminInquiryPage> ListInquiriesAsync(string? status, long? cursor, int? limit, CancellationToken cancellationToken = default)
    {
        SupportInquiryStatus? filter = null;
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!TryParseStatusName(status, out var parsed))
            {
                throw new InvalidAdminRequestException("status", "status must be Pending, InProgress or Answered.");
            }

            filter = parsed;
        }

        return inquiryStore.ListAsync(filter, cursor, ResolvePageSize(limit), cancellationToken);
    }

    public async Task<AdminInquiryDetail> GetInquiryAsync(long inquiryId, CancellationToken cancellationToken = default) =>
        await inquiryStore.GetAsync(inquiryId, cancellationToken) ?? throw new AdminInquiryNotFoundException();

    public async Task<AdminInquiryDetail> ChangeInquiryStatusAsync(long adminUserId, long inquiryId, string? status, CancellationToken cancellationToken = default)
    {
        if (!TryParseStatusName(status, out var parsed)
            || parsed is not (SupportInquiryStatus.Pending or SupportInquiryStatus.InProgress))
        {
            throw new InvalidAdminRequestException("status", "status must be Pending or InProgress (Answered is set by an answer).");
        }

        try
        {
            if (!await inquiryStore.ChangeStatusAsync(inquiryId, parsed, adminUserId, timeProvider.GetUtcNow(), cancellationToken))
            {
                throw new AdminInquiryNotFoundException();
            }
        }
        catch (SupportInquiryTransitionException exception)
        {
            throw new InvalidAdminRequestException("status", exception.Message);
        }

        return await GetInquiryAsync(inquiryId, cancellationToken);
    }

    public async Task<AdminInquiryDetail> AnswerInquiryAsync(long adminUserId, long inquiryId, string? answer, CancellationToken cancellationToken = default)
    {
        var trimmed = answer?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new InvalidAdminRequestException("answer", "answer is required.");
        }

        if (trimmed.Length > SupportInquiryService.MaxAnswerLength)
        {
            throw new InvalidAdminRequestException("answer", $"answer must be at most {SupportInquiryService.MaxAnswerLength} characters.");
        }

        if (!await inquiryStore.AnswerAsync(inquiryId, trimmed, adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminInquiryNotFoundException();
        }

        return await GetInquiryAsync(inquiryId, cancellationToken);
    }

    /// <summary>Exactly a declared state NAME - never a number ("2"), a different case or a combination.</summary>
    private static bool TryParseStatusName(string? value, out SupportInquiryStatus status)
    {
        status = default;
        return value is not null
            && Enum.GetNames<SupportInquiryStatus>().Contains(value, StringComparer.Ordinal)
            && Enum.TryParse(value, ignoreCase: false, out status);
    }

    private static int ResolvePageSize(int? limit) => limit is null or <= 0 ? DefaultPageSize : Math.Min(limit.Value, MaxPageSize);
}
