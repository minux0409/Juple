using Juple.Application.Admin;
using Juple.Application.Support;
using Juple.Domain.Support;

namespace Juple.UnitTests.Admin;

public sealed class SupportInquiryLifecycleTests
{
    private static readonly DateTimeOffset Created = new(2026, 10, 19, 1, 0, 0, TimeSpan.Zero);

    private static SupportInquiry NewInquiry() =>
        new(5, Guid.NewGuid(), SupportInquiryType.Bug, "It crashes", new SupportInquiryDiagnostics("1.0", "31", "android", "16", "SM-S936N", "ko-KR"), Created);

    [Fact]
    public void ANewInquiry_IsPending_AndUntouchedBySupport()
    {
        var inquiry = NewInquiry();

        Assert.Equal(SupportInquiryStatus.Pending, inquiry.Status);
        Assert.Null(inquiry.UpdatedAtUtc);
    }

    [Fact]
    public void PendingAndInProgress_MoveBothWays_AndRecordWhen()
    {
        var inquiry = NewInquiry();

        Assert.True(inquiry.ChangeUnansweredStatus(SupportInquiryStatus.InProgress, Created.AddHours(1)));
        Assert.Equal(SupportInquiryStatus.InProgress, inquiry.Status);
        Assert.Equal(Created.AddHours(1), inquiry.UpdatedAtUtc);
        Assert.False(inquiry.ChangeUnansweredStatus(SupportInquiryStatus.InProgress, Created.AddHours(2)));
        Assert.Equal(Created.AddHours(1), inquiry.UpdatedAtUtc);
        Assert.True(inquiry.ChangeUnansweredStatus(SupportInquiryStatus.Pending, Created.AddHours(3)));
        Assert.Equal(SupportInquiryStatus.Pending, inquiry.Status);
    }

    [Fact]
    public void Answered_IsReachedOnlyByAnAnswer_AndNeverTakenBack()
    {
        var inquiry = NewInquiry();
        Assert.Throws<SupportInquiryTransitionException>(() => inquiry.ChangeUnansweredStatus(SupportInquiryStatus.Answered, Created));

        inquiry.ChangeUnansweredStatus(SupportInquiryStatus.InProgress, Created.AddHours(1));
        inquiry.RecordAnswer("We fixed it.", Created.AddHours(2));
        Assert.Equal(SupportInquiryStatus.Answered, inquiry.Status);
        Assert.Equal(Created.AddHours(2), inquiry.UpdatedAtUtc);

        Assert.Throws<SupportInquiryTransitionException>(() => inquiry.ChangeUnansweredStatus(SupportInquiryStatus.Pending, Created.AddHours(3)));
        Assert.Throws<SupportInquiryTransitionException>(() => inquiry.ChangeUnansweredStatus(SupportInquiryStatus.InProgress, Created.AddHours(3)));
        Assert.Equal("We fixed it.", inquiry.Answer);

        // Editing the answer is allowed and keeps it answered.
        inquiry.RecordAnswer("We fixed it in 1.0 (31).", Created.AddHours(4));
        Assert.Equal(SupportInquiryStatus.Answered, inquiry.Status);
        Assert.Equal(Created.AddHours(4), inquiry.AnsweredAtUtc);
    }
}

public sealed class AdminServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 19, 3, 0, 0, TimeSpan.Zero);

    private readonly FakeInquiries _inquiries = new();
    private readonly FakeDashboard _dashboard = new();
    private readonly FakeDirectory _directory = new();

    private AdminService Service() => new(_dashboard, _directory, _inquiries, new FixedTime(Now));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Answered")]
    [InlineData("answered")]
    [InlineData("Closed")]
    [InlineData("2")]
    public async Task StatusChanges_AcceptOnlyPendingAndInProgress(string? status)
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().ChangeInquiryStatusAsync(1, 7, status));
        Assert.Null(_inquiries.LastStatus);
    }

    [Fact]
    public async Task AStatusChange_PassesTheAuthorizedAdminAndServerTime()
    {
        await Service().ChangeInquiryStatusAsync(42, 7, "InProgress");

        Assert.Equal((7L, SupportInquiryStatus.InProgress, 42L, Now), _inquiries.LastStatus);
    }

    [Fact]
    public async Task TakingBackAnAnswer_IsABadRequest_NotAServerError()
    {
        _inquiries.ThrowTransition = true;

        var exception = await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().ChangeInquiryStatusAsync(1, 7, "Pending"));
        Assert.Equal("status", exception.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task AnAnswer_IsRequired(string? answer)
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().AnswerInquiryAsync(1, 7, answer));
        Assert.Null(_inquiries.LastAnswer);
    }

    [Fact]
    public async Task AnAnswer_IsTrimmed_AndLimitedLikeTheExistingSupportRule()
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().AnswerInquiryAsync(1, 7, new string('a', SupportInquiryService.MaxAnswerLength + 1)));

        await Service().AnswerInquiryAsync(9, 7, "  Thanks!  ");
        Assert.Equal((7L, "Thanks!", 9L, Now), _inquiries.LastAnswer);
    }

    [Fact]
    public async Task AMissingInquiry_IsNotFound()
    {
        _inquiries.Exists = false;

        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => Service().AnswerInquiryAsync(1, 7, "x"));
        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => Service().ChangeInquiryStatusAsync(1, 7, "InProgress"));
        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => Service().GetInquiryAsync(7));
    }

    [Fact]
    public async Task TheInquiryList_FiltersOnlyByRealStatuses()
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().ListInquiriesAsync("Closed", null, null));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().ListInquiriesAsync("open", null, null));

        // "Open" (미답변) = 접수 and 처리중 together, not a stored status.
        await Service().ListInquiriesAsync("Open", null, null);
        Assert.Equal(((SupportInquiryStatus?)null, AdminService.DefaultPageSize), _inquiries.LastList);
        Assert.True(_inquiries.LastOpenOnly);

        await Service().ListInquiriesAsync("InProgress", null, 500);
        Assert.False(_inquiries.LastOpenOnly);
        Assert.Equal((SupportInquiryStatus.InProgress, AdminService.MaxPageSize), _inquiries.LastList);
        await Service().ListInquiriesAsync(null, null, null);
        Assert.Equal(((SupportInquiryStatus?)null, AdminService.DefaultPageSize), _inquiries.LastList);
    }

    [Fact]
    public async Task UserSearch_IsAnExactNormalizedJupleId_AndRejectsAnythingElse()
    {
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().ListUsersAsync("bob@example.com", null, null));

        await Service().ListUsersAsync("@qzam-qbqk", null, null);
        Assert.Equal("QZAMQBQK", _directory.LastExact);
    }

    [Fact]
    public async Task Today_IsTheAdminsOwnMidnight_WithinADayAndAHalf_ElseUtcMidnight()
    {
        await Service().GetDashboardSummaryAsync(null);
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 0, 0, 0, TimeSpan.Zero), _dashboard.LastTodayStart);

        var seoulMidnight = new DateTimeOffset(2026, 10, 19, 0, 0, 0, TimeSpan.FromHours(9));
        await Service().GetDashboardSummaryAsync(seoulMidnight);
        Assert.Equal(seoulMidnight.ToUniversalTime(), _dashboard.LastTodayStart);

        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().GetDashboardSummaryAsync(Now.AddHours(1)));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().GetDashboardSummaryAsync(Now.AddDays(-30)));
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeInquiries : IAdminSupportInquiryStore
    {
        public bool Exists { get; set; } = true;

        public bool ThrowTransition { get; set; }

        public (long, SupportInquiryStatus, long, DateTimeOffset)? LastStatus { get; private set; }

        public (long, string, long, DateTimeOffset)? LastAnswer { get; private set; }

        public (SupportInquiryStatus?, int)? LastList { get; private set; }

        public bool LastOpenOnly { get; private set; }

        public Task<AdminInquiryPage> ListAsync(SupportInquiryStatus? status, long? cursor, int limit, bool openOnly, CancellationToken cancellationToken = default)
        {
            LastList = (status, limit);
            LastOpenOnly = openOnly;
            return Task.FromResult(new AdminInquiryPage([], null));
        }

        public Task<AdminInquiryDetail?> GetAsync(long inquiryId, CancellationToken cancellationToken = default) =>
            Task.FromResult<AdminInquiryDetail?>(Exists
                ? new AdminInquiryDetail(inquiryId, "Pending", "Bug", null, "c", null, Now, null, null, new AdminInquiryDiagnostics(null, null, null, null, null, null), [])
                : null);

        public Task<bool> ChangeStatusAsync(long inquiryId, SupportInquiryStatus status, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            if (ThrowTransition)
            {
                throw new SupportInquiryTransitionException("answered");
            }

            LastStatus = (inquiryId, status, adminUserId, nowUtc);
            return Task.FromResult(Exists);
        }

        public Task<bool> AnswerAsync(long inquiryId, string answer, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastAnswer = (inquiryId, answer, adminUserId, nowUtc);
            return Task.FromResult(Exists);
        }
    }

    private sealed class FakeDashboard : IAdminDashboardStore
    {
        public DateTimeOffset? LastTodayStart { get; private set; }

        public Task<AdminDashboardSummary> GetSummaryAsync(DateTimeOffset todayStartUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastTodayStart = todayStartUtc;
            return Task.FromResult(new AdminDashboardSummary(todayStartUtc, nowUtc, 0, 0, 0, 0, 0, 0, 0, 0));
        }
    }

    private sealed class FakeDirectory : IAdminUserDirectoryStore
    {
        public string? LastExact { get; private set; }

        public Task<AdminUserPage> ListAsync(string? exactJupleId, long? cursor, int limit, CancellationToken cancellationToken = default)
        {
            LastExact = exactJupleId;
            return Task.FromResult(new AdminUserPage([], null));
        }
    }
}
