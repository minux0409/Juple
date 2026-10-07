using Juple.Application.Support;
using Juple.Domain.Support;

namespace Juple.UnitTests.Support;

public sealed class SupportInquiryServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 7, 9, 0, 0, TimeSpan.Zero);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class InMemoryStore : ISupportInquiryStore
    {
        private long _nextId = 1;
        public List<SupportInquiry> Rows { get; } = [];

        public Task<(SupportInquiry Inquiry, bool Created)> CreateAsync(SupportInquiry inquiry, CancellationToken cancellationToken = default)
        {
            var existing = Rows.FirstOrDefault(row => row.UserId == inquiry.UserId && row.ClientRequestId == inquiry.ClientRequestId);
            if (existing is not null)
            {
                return Task.FromResult((existing, false));
            }

            typeof(SupportInquiry).GetProperty(nameof(SupportInquiry.Id))!.SetValue(inquiry, _nextId++);
            Rows.Add(inquiry);
            return Task.FromResult((inquiry, true));
        }

        public Task<IReadOnlyList<SupportInquiry>> ListAsync(long userId, long? cursor, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<SupportInquiry>>(Rows
                .Where(row => row.UserId == userId && (cursor is null || row.Id < cursor))
                .OrderByDescending(row => row.Id)
                .Take(limit)
                .ToList());

        public Task<SupportInquiry?> FindAsync(long userId, long inquiryId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Rows.FirstOrDefault(row => row.Id == inquiryId && row.UserId == userId));

        public Task<bool> AnswerAsync(long inquiryId, string answer, DateTimeOffset answeredAtUtc, CancellationToken cancellationToken = default)
        {
            var row = Rows.FirstOrDefault(entry => entry.Id == inquiryId);
            row?.RecordAnswer(answer, answeredAtUtc);
            return Task.FromResult(row is not null);
        }
    }

    private static (SupportInquiryService Service, InMemoryStore Store) Create()
    {
        var store = new InMemoryStore();
        return (new SupportInquiryService(store, new FixedTime(Now)), store);
    }

    private static CreateSupportInquiryCommand Command(
        Guid? requestId = null,
        string? type = "Bug",
        string? content = "Images do not show",
        SupportInquiryDiagnosticsInput? diagnostics = null) =>
        new(requestId ?? Guid.NewGuid(), type, content, diagnostics);

    [Fact]
    public async Task Create_StoresTrimmedContentPendingWithOwnerAndTime()
    {
        var (service, store) = Create();

        var result = await service.CreateAsync(7, Command(content: "  hello  \n"));

        Assert.True(result.Created);
        Assert.Equal("hello", result.Inquiry.Content);
        Assert.Equal("Pending", result.Inquiry.Status);
        Assert.Equal("Bug", result.Inquiry.Type);
        Assert.Equal(Now, result.Inquiry.CreatedAtUtc);
        Assert.Null(result.Inquiry.Answer);
        Assert.Equal(7, store.Rows.Single().UserId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("bug")]
    [InlineData("2")]
    [InlineData("Everything")]
    [InlineData("버그")]
    public async Task Create_RejectsUnknownOrMissingType(string? type)
    {
        var (service, _) = Create();
        var exception = await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.CreateAsync(1, Command(type: type)));
        Assert.Equal("type", exception.Field);
    }

    [Theory]
    [InlineData("Account")]
    [InlineData("Subscription")]
    [InlineData("LinkSaving")]
    [InlineData("CollectionSharing")]
    [InlineData("Bug")]
    [InlineData("FeatureRequest")]
    [InlineData("Other")]
    public async Task Create_AcceptsEveryStableTypeCode(string type)
    {
        var (service, _) = Create();
        var result = await service.CreateAsync(1, Command(type: type));
        Assert.Equal(type, result.Inquiry.Type);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\t ")]
    public async Task Create_RejectsMissingOrWhitespaceContent(string? content)
    {
        var (service, _) = Create();
        var exception = await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.CreateAsync(1, Command(content: content)));
        Assert.Equal("content", exception.Field);
    }

    [Fact]
    public async Task Create_AllowsExactlyTheMaximumLengthAndRejectsOneMore()
    {
        var (service, _) = Create();
        var atLimit = await service.CreateAsync(1, Command(content: new string('a', SupportInquiryService.MaxContentLength)));
        Assert.Equal(SupportInquiryService.MaxContentLength, atLimit.Inquiry.Content.Length);

        var exception = await Assert.ThrowsAsync<InvalidSupportInquiryException>(
            () => service.CreateAsync(1, Command(content: new string('a', SupportInquiryService.MaxContentLength + 1))));
        Assert.Equal("content", exception.Field);
    }

    [Fact]
    public async Task Create_RequiresARealClientRequestId()
    {
        var (service, _) = Create();
        await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.CreateAsync(1, new CreateSupportInquiryCommand(null, "Bug", "x", null)));
        await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.CreateAsync(1, new CreateSupportInquiryCommand(Guid.Empty, "Bug", "x", null)));
    }

    [Fact]
    public async Task Create_SameRequestIdForSameUser_ReturnsTheSameInquiryWithoutADuplicate()
    {
        var (service, store) = Create();
        var requestId = Guid.NewGuid();

        var first = await service.CreateAsync(1, Command(requestId));
        var retry = await service.CreateAsync(1, Command(requestId));

        Assert.True(first.Created);
        Assert.False(retry.Created);
        Assert.Equal(first.Inquiry.InquiryId, retry.Inquiry.InquiryId);
        Assert.Single(store.Rows);
    }

    [Fact]
    public async Task Create_SameRequestIdForADifferentUser_IsIndependent()
    {
        var (service, store) = Create();
        var requestId = Guid.NewGuid();

        var first = await service.CreateAsync(1, Command(requestId));
        var other = await service.CreateAsync(2, Command(requestId));

        Assert.True(other.Created);
        Assert.NotEqual(first.Inquiry.InquiryId, other.Inquiry.InquiryId);
        Assert.Equal(2, store.Rows.Count);
    }

    [Fact]
    public async Task Create_SameRequestIdWithADifferentQuestion_IsAConflict()
    {
        var (service, _) = Create();
        var requestId = Guid.NewGuid();
        await service.CreateAsync(1, Command(requestId, content: "first"));

        await Assert.ThrowsAsync<SupportInquiryClientRequestConflictException>(() => service.CreateAsync(1, Command(requestId, content: "second")));
        await Assert.ThrowsAsync<SupportInquiryClientRequestConflictException>(() => service.CreateAsync(1, Command(requestId, type: "Other", content: "first")));
    }

    [Fact]
    public async Task Create_KeepsOnlyBoundedAppAndDeviceDiagnostics()
    {
        var (service, store) = Create();

        await service.CreateAsync(1, Command(diagnostics: new SupportInquiryDiagnosticsInput(
            " 1.2.3 ", "45", "android", "15", "SM-S936N", "ko-KR")));
        var row = store.Rows.Single();
        Assert.Equal(("1.2.3", "45", "android", "15", "SM-S936N", "ko-KR"), (row.AppVersion, row.BuildNumber, row.Platform, row.OsVersion, row.DeviceModel, row.Locale));
    }

    [Fact]
    public async Task Create_NeverFailsOnDiagnostics_BlankIsNullControlCharsDroppedLongValuesCut()
    {
        var (service, store) = Create();

        await service.CreateAsync(1, Command(diagnostics: new SupportInquiryDiagnosticsInput(
            "   ", null, "an\nd\0roid", new string('9', 500), new string('m', 500), "")));
        var row = store.Rows.Single();
        Assert.Null(row.AppVersion);
        Assert.Null(row.BuildNumber);
        Assert.Equal("android", row.Platform);
        Assert.Equal(32, row.OsVersion!.Length);
        Assert.Equal(100, row.DeviceModel!.Length);
        Assert.Null(row.Locale);

        await service.CreateAsync(1, Command(diagnostics: null));
        Assert.Null(store.Rows[1].AppVersion);
    }

    [Fact]
    public async Task List_ReturnsOnlyTheCallersInquiriesNewestFirstInKeysetPages()
    {
        var (service, _) = Create();
        for (var index = 1; index <= 5; index++)
        {
            await service.CreateAsync(1, Command(content: $"mine {index}"));
        }

        await service.CreateAsync(2, Command(content: "someone else's"));

        var first = await service.ListAsync(1, cursor: null, limit: 2);
        Assert.Equal(["mine 5", "mine 4"], first.Items.Select(item => item.Content));
        Assert.NotNull(first.NextCursor);

        var second = await service.ListAsync(1, first.NextCursor, limit: 2);
        Assert.Equal(["mine 3", "mine 2"], second.Items.Select(item => item.Content));

        var last = await service.ListAsync(1, second.NextCursor, limit: 2);
        Assert.Equal(["mine 1"], last.Items.Select(item => item.Content));
        Assert.Null(last.NextCursor);
    }

    [Fact]
    public async Task List_ExactlyOnePageHasNoNextCursor()
    {
        var (service, _) = Create();
        await service.CreateAsync(1, Command(content: "a"));
        await service.CreateAsync(1, Command(content: "b"));

        var page = await service.ListAsync(1, cursor: null, limit: 2);

        Assert.Equal(2, page.Items.Count);
        Assert.Null(page.NextCursor);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(51)]
    public async Task List_RejectsAnOutOfRangeLimit(int limit)
    {
        var (service, _) = Create();
        var exception = await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.ListAsync(1, null, limit));
        Assert.Equal("limit", exception.Field);
    }

    [Fact]
    public async Task Get_AnotherUsersInquiryIsNotFound()
    {
        var (service, _) = Create();
        var theirs = await service.CreateAsync(2, Command());

        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.GetAsync(1, theirs.Inquiry.InquiryId));
        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.GetAsync(1, 99999));
        Assert.Equal(theirs.Inquiry.InquiryId, (await service.GetAsync(2, theirs.Inquiry.InquiryId)).InquiryId);
    }

    [Fact]
    public async Task Answer_SetsAnsweredWithTrimmedAnswerAndTime()
    {
        var (service, _) = Create();
        var created = await service.CreateAsync(1, Command());

        await service.AnswerAsync(created.Inquiry.InquiryId, "  Thanks, fixed.  ");

        var inquiry = await service.GetAsync(1, created.Inquiry.InquiryId);
        Assert.Equal("Answered", inquiry.Status);
        Assert.Equal("Thanks, fixed.", inquiry.Answer);
        Assert.Equal(Now, inquiry.AnsweredAtUtc);
    }

    [Fact]
    public async Task Answer_RequiresAnAnswerWithinTheLimitAndAnExistingInquiry()
    {
        var (service, _) = Create();
        var created = await service.CreateAsync(1, Command());

        await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.AnswerAsync(created.Inquiry.InquiryId, "   "));
        await Assert.ThrowsAsync<InvalidSupportInquiryException>(() => service.AnswerAsync(created.Inquiry.InquiryId, null));
        await Assert.ThrowsAsync<InvalidSupportInquiryException>(
            () => service.AnswerAsync(created.Inquiry.InquiryId, new string('a', SupportInquiryService.MaxAnswerLength + 1)));
        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.AnswerAsync(424242, "x"));
        Assert.Equal("Pending", (await service.GetAsync(1, created.Inquiry.InquiryId)).Status);
    }

    [Fact]
    public async Task Answer_AgainReplacesTheAnswer()
    {
        var (service, _) = Create();
        var created = await service.CreateAsync(1, Command());

        await service.AnswerAsync(created.Inquiry.InquiryId, "first");
        await service.AnswerAsync(created.Inquiry.InquiryId, "second");

        Assert.Equal("second", (await service.GetAsync(1, created.Inquiry.InquiryId)).Answer);
    }
}
