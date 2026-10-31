using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Controllers.Admin;
using Juple.Application.Admin;
using Juple.Application.Safety;
using Juple.Domain.Safety;
using Microsoft.AspNetCore.Authorization;

namespace Juple.UnitTests.Safety;

public sealed class SharedContentModerationTests
{
    [Theory]
    [InlineData("https://a.example https://b.example https://c.example", "autoFilter:manyUrls")]
    [InlineData("see https://a.example and https://b.example", null)]
    [InlineData("hello world", null)]
    [InlineData("", null)]
    public void CheckText_OnlyAsksAboutManyAddresses(string text, string? expected) =>
        Assert.Equal(expected, SharedContentFilter.CheckText(text));

    [Fact]
    public void CheckText_RepeatedCharactersRaiseAReview_ButWordsAndSpacesDoNot()
    {
        Assert.Equal("autoFilter:repeatedCharacters", SharedContentFilter.CheckText(new string('a', SharedContentFilter.RepeatedCharacterRun)));
        Assert.Null(SharedContentFilter.CheckText(new string('a', SharedContentFilter.RepeatedCharacterRun - 1)));
        Assert.Null(SharedContentFilter.CheckText(new string(' ', 40) + "x"));
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=1", null)] // An external link is not suspicious for being external.
    [InlineData("http://shop.example/a?b=c", null)]
    [InlineData("https://user:secret@bank.example/", "autoFilter:urlCredentials")]
    [InlineData("http://203.0.113.9/login", "autoFilter:urlNumericHost")]
    [InlineData("http://[2001:db8::1]/", "autoFilter:urlNumericHost")]
    [InlineData("https://xn--e1awd7f.example/", "autoFilter:urlPunycodeHost")]
    [InlineData("not a url", null)]
    public void CheckUrl_AsksOnlyAboutSuspiciousShapes(string url, string? expected) =>
        Assert.Equal(expected, SharedContentFilter.CheckUrl(url));

    [Fact]
    public void AutoFilterReport_HasNoReporter_AndStartsUnreviewed()
    {
        var report = ContentReport.FromAutoFilter(ReportTargetType.Comment, 5, 7, 9, "autoFilter:manyUrls", DateTimeOffset.UnixEpoch, "words", null);

        Assert.Null(report.ReporterUserId);
        Assert.Equal(ReportSource.AutoFilter, report.Source);
        Assert.Equal(ReportStatus.Pending, report.Status);
        Assert.Null(report.ReviewedAtUtc);
    }

    [Fact]
    public void Snapshot_IsCutToItsLimit()
    {
        var report = new ContentReport(1, ReportTargetType.Item, 2, 3, 4, ReportReason.Spam, null, DateTimeOffset.UnixEpoch, new string('t', 400), new string('u', 3000));

        Assert.Equal(ContentReport.SnapshotTitleMaxLength, report.SnapshotTitle!.Length);
        Assert.Equal(ContentReport.SnapshotUrlMaxLength, report.SnapshotUrl!.Length);
        Assert.Equal(ReportSource.User, report.Source);
    }

    [Fact]
    public void Review_RecordsWhoAndWhen_AndAMissingNoteKeepsTheEarlierOne()
    {
        var report = new ContentReport(1, ReportTargetType.Collection, 2, 3, 2, ReportReason.Spam, null, DateTimeOffset.UnixEpoch);
        var later = DateTimeOffset.UnixEpoch.AddDays(1);

        report.Review(ReportStatus.InReview, 42, "looking", later);
        report.Review(ReportStatus.Actioned, 43, null, later);

        Assert.Equal(ReportStatus.Actioned, report.Status);
        Assert.Equal(43, report.ReviewedByAdminUserId);
        Assert.Equal(later, report.ReviewedAtUtc);
        Assert.Equal("looking", report.Resolution);
    }

    [Fact]
    public void Restriction_StaysInForceUntilLifted()
    {
        var restriction = new ShareRestriction(1, null, 2, 3, DateTimeOffset.UnixEpoch);
        Assert.Null(restriction.LiftedAtUtc);

        restriction.Lift(4, DateTimeOffset.UnixEpoch.AddDays(1));

        Assert.Equal(4, restriction.LiftedByAdminUserId);
        Assert.NotNull(restriction.LiftedAtUtc);
    }

    [Fact]
    public void AdminReports_RequireTheAdminPolicy()
    {
        var authorize = typeof(AdminReportsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthorizationPolicies.JupleAdmin, authorize?.Policy);
        Assert.DoesNotContain(
            typeof(AdminReportsController).GetMethods(BindingFlags.Public | BindingFlags.Instance),
            method => method.GetCustomAttribute<AllowAnonymousAttribute>() is not null);
    }

    [Theory]
    [InlineData("Pending")]  // An operator cannot put a report back to "nobody looked".
    [InlineData("Reviewed")] // Legacy value, not an action.
    [InlineData("nonsense")]
    [InlineData(null)]
    public async Task AdminStatus_AcceptsOnlyTheThreeActions(string? status)
    {
        var service = new AdminReportService(new FakeStore(), TimeProvider.System);
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => service.ChangeStatusAsync(1, 2, status, null));
    }

    [Theory]
    [InlineData("InReview", ReportStatus.InReview)]
    [InlineData("Dismissed", ReportStatus.Dismissed)]
    [InlineData("Actioned", ReportStatus.Actioned)]
    public async Task AdminStatus_MapsTheActions(string status, ReportStatus expected)
    {
        var store = new FakeStore();
        await new AdminReportService(store, TimeProvider.System).ChangeStatusAsync(1, 2, status, " note ");

        Assert.Equal(expected, store.LastStatus);
        Assert.Equal("note", store.LastNote);
    }

    [Fact]
    public async Task AdminNote_HasALimit_AndAMissingReportIsNotFound()
    {
        var service = new AdminReportService(new FakeStore(), TimeProvider.System);
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => service.RestrictAsync(1, 2, new string('n', ContentReport.ResolutionMaxLength + 1)));
        await Assert.ThrowsAsync<AdminReportNotFoundException>(() => new AdminReportService(new FakeStore { Exists = false }, TimeProvider.System).LiftRestrictionAsync(1, 2, null));
    }

    [Fact]
    public async Task AdminList_DefaultsToWhatIsStillOpen()
    {
        var store = new FakeStore();
        await new AdminReportService(store, TimeProvider.System).ListAsync(null, null, null);

        Assert.Equal([ReportStatus.Pending, ReportStatus.InReview], store.LastFilter);
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => new AdminReportService(store, TimeProvider.System).ListAsync("all", null, null));
    }

    private sealed class FakeStore : IAdminReportStore
    {
        public bool Exists { get; init; } = true;

        public ReportStatus? LastStatus { get; private set; }

        public string? LastNote { get; private set; }

        public IReadOnlyCollection<ReportStatus>? LastFilter { get; private set; }

        public Task<AdminReportPage> ListAsync(IReadOnlyCollection<ReportStatus> statuses, long? cursor, int limit, CancellationToken cancellationToken = default)
        {
            LastFilter = statuses;
            return Task.FromResult(new AdminReportPage([], null));
        }

        public Task<AdminReportDetail?> GetAsync(long reportId, CancellationToken cancellationToken = default) =>
            Task.FromResult<AdminReportDetail?>(new AdminReportDetail(
                reportId, DateTimeOffset.UnixEpoch, "Collection", 1, 1, "Spam", null, "Pending", "User", null, null, null, null, null, null, true, true, false, null, null, null, null, [], []));

        public Task<bool> ChangeStatusAsync(long reportId, ReportStatus status, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastStatus = status;
            LastNote = note;
            return Task.FromResult(Exists);
        }

        public Task<bool> RestrictAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.FromResult(Exists);

        public Task<bool> LiftRestrictionAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.FromResult(Exists);
    }
}
