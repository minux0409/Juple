using Juple.Domain.Users;

namespace Juple.Application.Admin;

/// <summary>
/// The Admin Web's first screen: three numbers, each with one daily chart that ends exactly at that number. All Seoul (KST)
/// calendar days; instants stay UTC in the database.
/// TotalUsers = accounts that exist now. LiveLinks = saved links not in the trash. TodaySignups = accounts created since today's
/// 00:00 Asia/Seoul. A deleted account (and its links) is removed from the database, so it is absent from every number and every
/// past day - see <see cref="AdminInsightsDefinitions"/>.
/// </summary>
public sealed record AdminDashboardKpis(int TotalUsers, int LiveLinks, int TodaySignups, DateOnly SeoulToday, string TimeZone, DateTimeOffset GeneratedAtUtc);

public sealed record AdminMetricPoint(DateOnly Date, int Value);

/// <summary>One chart. Metric = users | links | signups. Definition is the sentence the Admin Web shows under the chart.</summary>
public sealed record AdminMetricSeries(
    string Metric,
    DateOnly From,
    DateOnly Through,
    string TimeZone,
    DateTimeOffset GeneratedAtUtc,
    IReadOnlyList<AdminMetricPoint> Points,
    string Definition);

public static class AdminInsightsDefinitions
{
    public const string TimeZone = "Asia/Seoul";

    public const string Users =
        "각 날짜 23:59(KST) 시점의 가입 계정 수입니다. 현재 남아 있는 계정의 가입일로 계산하므로 탈퇴한 계정은 과거 날짜에서도 빠집니다(탈퇴 이력은 저장되지 않아 복원할 수 없습니다). 마지막 날 값은 상단의 전체 사용자 수와 같습니다.";

    public const string Links =
        "각 날짜 23:59(KST) 시점에 휴지통에 있지 않았던 저장 링크 수입니다. 현재 남아 있는 링크의 저장 시각과 휴지통 이동 시각으로 계산하며, 영구 삭제된 링크와 탈퇴 계정의 링크는 과거 날짜에서도 빠집니다. 휴지통에서 복원된 링크는 처음부터 유지된 것으로 계산됩니다. 마지막 날 값은 상단의 전체 저장 링크 수와 같습니다.";

    public const string Signups =
        "해당 날짜 00:00~24:00(KST)에 생성된 계정 수입니다. 탈퇴한 계정은 생성일에서도 빠집니다.";
}

public sealed record AdminLanguageCount(string Language, int Users);

/// <summary>
/// One row of the 사용자 table. LinkCount = this account's saved links not in the trash (the dashboard's definition).
/// PreferredLocale is the device locale the account was created with (the app does not update it later); Language is its
/// primary language subtag ("ko" for "ko-KR").
/// </summary>
public sealed record AdminUserDirectoryRow(long UserId, string JupleId, string? DisplayName, int LinkCount, string PreferredLocale, string Language, DateTimeOffset CreatedAtUtc);

public sealed record AdminUserDirectoryPage(IReadOnlyList<AdminUserDirectoryRow> Items, int Page, int PageSize, int Total, IReadOnlyList<AdminLanguageCount> Languages);

public enum AdminUserSearchField { JupleId, Nickname }

public enum AdminUserSort { CreatedDesc, CreatedAsc, LinksDesc, LinksAsc }

public sealed record AdminUserDirectoryQuery(string? Search, AdminUserSearchField SearchField, string? Language, AdminUserSort Sort, int Page, int PageSize);

/// <summary>One day (or one month) of a person's saving: links saved then (trash included, permanently deleted ones gone) and the running total.</summary>
public sealed record AdminUserLinkBucket(DateOnly Start, int Saved, int CumulativeSaved);

/// <summary>
/// The person's saving history from their sign-up day (KST) to today. LiveLinks is what they hold NOW (not in the trash) - a
/// different number from the sum of daily saves, which also counts links that were later moved to the trash.
/// </summary>
public sealed record AdminUserLinkHistory(
    long UserId,
    string JupleId,
    string? DisplayName,
    DateTimeOffset CreatedAtUtc,
    DateOnly SignupDate,
    DateOnly Through,
    string Granularity,
    int LiveLinks,
    int SavedSinceSignup,
    IReadOnlyList<AdminUserLinkBucket> Buckets,
    string TimeZone,
    DateTimeOffset GeneratedAtUtc);

public interface IAdminInsightsStore
{
    Task<AdminDashboardKpis> KpisAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<AdminMetricSeries> SeriesAsync(string metric, AdminDateRange period, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<AdminUserDirectoryPage> UsersAsync(AdminUserDirectoryQuery query, CancellationToken cancellationToken = default);

    Task<AdminUserLinkHistory?> UserLinkHistoryAsync(long userId, bool monthly, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

/// <summary>Validation for the Admin Web's dashboard and user screens; every aggregate itself runs in SQL (the store).</summary>
public sealed class AdminInsightsService(IAdminInsightsStore store, TimeProvider timeProvider)
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 100;
    public const int MaxPage = 10_000;

    /// <summary>Daily buckets are offered up to two years after sign-up; a longer history is answered per month.</summary>
    public const int MaxDailyBuckets = 731;

    public static readonly IReadOnlyList<string> Metrics = ["users", "links", "signups"];

    public Task<AdminDashboardKpis> KpisAsync(CancellationToken cancellationToken = default) => store.KpisAsync(timeProvider.GetUtcNow(), cancellationToken);

    public Task<AdminMetricSeries> SeriesAsync(string? metric, string? range, DateOnly? from, DateOnly? through, CancellationToken cancellationToken = default)
    {
        if (metric is null || !Metrics.Contains(metric, StringComparer.Ordinal))
        {
            throw new InvalidAdminRequestException("metric", "Choose users, links or signups.");
        }

        var now = timeProvider.GetUtcNow();
        return store.SeriesAsync(metric, AdminDateRange.Resolve(range, from, through, now), now, cancellationToken);
    }

    public Task<AdminUserDirectoryPage> UsersAsync(
        string? search,
        string? searchField,
        string? language,
        string? sort,
        int? page,
        int? pageSize,
        CancellationToken cancellationToken = default)
    {
        var field = searchField switch
        {
            null or "" or "jupleId" => AdminUserSearchField.JupleId,
            "nickname" => AdminUserSearchField.Nickname,
            _ => throw new InvalidAdminRequestException("searchField", "Use jupleId or nickname."),
        };
        var order = sort switch
        {
            null or "" or "createdDesc" => AdminUserSort.CreatedDesc,
            "createdAsc" => AdminUserSort.CreatedAsc,
            "linksDesc" => AdminUserSort.LinksDesc,
            "linksAsc" => AdminUserSort.LinksAsc,
            _ => throw new InvalidAdminRequestException("sort", "Use createdDesc, createdAsc, linksDesc or linksAsc."),
        };

        var text = search?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            text = null;
        }
        else if (field == AdminUserSearchField.JupleId)
        {
            // The apps show "@K7MP-4Q8N" or "@K7MP4Q8N": "@", dashes and case are presentation. A prefix of the code is searched.
            text = text.TrimStart('@').Replace("-", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
            if (text.Length > UserPublicCode.Length || !text.All(char.IsAsciiLetterOrDigit))
            {
                throw new InvalidAdminRequestException("search", "A Juple ID has at most 8 letters and digits.");
            }
        }
        else if (text.Length > 50)
        {
            throw new InvalidAdminRequestException("search", "Search at most 50 characters of a nickname.");
        }

        var languageFilter = language?.Trim();
        if (string.IsNullOrEmpty(languageFilter))
        {
            languageFilter = null;
        }
        else if (languageFilter.Length > 8 || !languageFilter.All(char.IsAsciiLetterLower))
        {
            throw new InvalidAdminRequestException("language", "Use a primary language subtag such as ko or en.");
        }

        var resolvedPage = page is null or < 1 ? 1 : page.Value;
        if (resolvedPage > MaxPage)
        {
            throw new InvalidAdminRequestException("page", $"page must be at most {MaxPage}.");
        }

        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaxPageSize);
        return store.UsersAsync(new AdminUserDirectoryQuery(text, field, languageFilter, order, resolvedPage, size), cancellationToken);
    }

    public async Task<AdminUserLinkHistory> UserLinkHistoryAsync(long userId, string? granularity, CancellationToken cancellationToken = default)
    {
        var monthly = granularity switch
        {
            null or "" or "day" => false,
            "month" => true,
            _ => throw new InvalidAdminRequestException("granularity", "Use day or month."),
        };
        return await store.UserLinkHistoryAsync(userId, monthly, timeProvider.GetUtcNow(), cancellationToken)
            ?? throw new AdminUserNotFoundException();
    }
}
