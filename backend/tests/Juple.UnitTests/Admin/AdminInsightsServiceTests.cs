using Juple.Application.Admin;
using Juple.Infrastructure.Analytics;

namespace Juple.UnitTests.Admin;

/// <summary>대시보드 / 사용자: request validation happens before any SQL; the store sees only normalized values.</summary>
public sealed class AdminInsightsServiceTests
{
    private readonly RecordingStore _store = new();
    private readonly FixedClock _clock = new(new DateTimeOffset(2026, 10, 28, 3, 0, 0, TimeSpan.Zero));

    private AdminInsightsService Service() => new(_store, _clock);

    [Theory]
    [InlineData("@k7mp-4q8n", "K7MP4Q8N")]
    [InlineData(" k7mp ", "K7MP")]
    [InlineData("K7MP4Q8N", "K7MP4Q8N")]
    public async Task AJupleIdSearch_IsAnUppercasePrefixWithoutPresentation(string input, string expected)
    {
        await Service().UsersAsync(input, "jupleId", null, null, null, null);
        Assert.Equal(expected, _store.LastUsers!.Search);
        Assert.Equal(AdminUserSearchField.JupleId, _store.LastUsers.SearchField);
    }

    [Theory]
    [InlineData("K7MP4Q8N9")]
    [InlineData("K7%")]
    [InlineData("K7 MP")]
    public async Task AnImpossibleJupleId_IsRefused(string input)
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().UsersAsync(input, "jupleId", null, null, null, null));
        Assert.Null(_store.LastUsers);
    }

    [Fact]
    public async Task DefaultsAndBounds_AreApplied()
    {
        await Service().UsersAsync(null, null, null, null, 0, 500);
        Assert.Equal(new AdminUserDirectoryQuery(null, AdminUserSearchField.JupleId, null, AdminUserSort.CreatedDesc, 1, AdminInsightsService.MaxPageSize), _store.LastUsers);

        await Service().UsersAsync(" 민 ", "nickname", "ko", "linksDesc", 3, 20);
        Assert.Equal(new AdminUserDirectoryQuery("민", AdminUserSearchField.Nickname, "ko", AdminUserSort.LinksDesc, 3, 20), _store.LastUsers);
    }

    [Theory]
    [InlineData("email", null, null)]
    [InlineData(null, "name", null)]
    [InlineData(null, null, "KO")]
    [InlineData(null, null, "ko-KR")]
    public async Task AnUnknownFieldSortOrLanguage_IsRefused(string? field, string? sort, string? language)
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().UsersAsync("x", field, language, sort, null, null));
    }

    [Fact]
    public async Task APageBeyondTheLimit_IsRefused()
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().UsersAsync(null, null, null, null, AdminInsightsService.MaxPage + 1, null));
    }

    [Theory]
    [InlineData("users")]
    [InlineData("links")]
    [InlineData("signups")]
    public async Task EachDashboardMetric_UsesTheSeoulPeriod(string metric)
    {
        await Service().SeriesAsync(metric, "7d", null, null);

        Assert.Equal(metric, _store.LastMetric);
        // 2026-10-28 03:00 UTC is 12:00 in Seoul: the last seven Seoul days end today.
        Assert.Equal(new AdminDateRange(new DateOnly(2026, 10, 22), new DateOnly(2026, 10, 28)), _store.LastPeriod);
    }

    [Theory]
    [InlineData("revenue", "7d")]
    [InlineData(null, "7d")]
    [InlineData("users", "1y")]
    public async Task AnUnknownMetricOrRange_IsRefused(string? metric, string range)
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().SeriesAsync(metric, range, null, null));
    }

    [Fact]
    public async Task AnUnknownPerson_Is404_AndTheGranularityIsValidated()
    {
        await Assert.ThrowsAsync<AdminUserNotFoundException>(() => Service().UserLinkHistoryAsync(99, "day"));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().UserLinkHistoryAsync(99, "week"));
    }

    [Theory]
    [InlineData("ko-KR", "ko")]
    [InlineData("zh_Hant_TW", "zh")]
    [InlineData("EN-us", "en")]
    [InlineData("", "und")]
    public void ThePrimaryLanguage_IsTheFirstSubtag(string locale, string expected)
    {
        Assert.Equal(expected, AdminInsightsStore.PrimaryLanguage(locale));
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class RecordingStore : IAdminInsightsStore
    {
        public AdminUserDirectoryQuery? LastUsers { get; private set; }

        public string? LastMetric { get; private set; }

        public AdminDateRange? LastPeriod { get; private set; }

        public Task<AdminDashboardKpis> KpisAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminDashboardKpis(0, 0, 0, AdminDateRange.SeoulDate(nowUtc), "Asia/Seoul", nowUtc));

        public Task<AdminMetricSeries> SeriesAsync(string metric, AdminDateRange period, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            (LastMetric, LastPeriod) = (metric, period);
            return Task.FromResult(new AdminMetricSeries(metric, period.From, period.Through, "Asia/Seoul", nowUtc, [], ""));
        }

        public Task<AdminUserDirectoryPage> UsersAsync(AdminUserDirectoryQuery query, CancellationToken cancellationToken = default)
        {
            LastUsers = query;
            return Task.FromResult(new AdminUserDirectoryPage([], query.Page, query.PageSize, 0, []));
        }

        public Task<AdminUserLinkHistory?> UserLinkHistoryAsync(long userId, bool monthly, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<AdminUserLinkHistory?>(null);
    }
}
