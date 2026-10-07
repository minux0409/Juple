using Juple.Application.Support;
using Juple.Domain.Support;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Support;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Support;

public sealed class SupportInquiryIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private long _userId;
    private long _otherUserId;
    private readonly List<long> _userIds = [];

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run support inquiry integration tests " +
                "against a local SQL Server instance.");
        _db = NewContext();

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var other = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.AddRange(user, other);
        await _db.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = other.Id;
        _userIds.AddRange([_userId, _otherUserId]);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/support/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/support/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private SupportInquiryService NewService(JupleDbContext? context = null) =>
        new(new SupportInquiryStore(context ?? NewContext()), TimeProvider.System);

    private static CreateSupportInquiryCommand Command(Guid? requestId = null, string type = "Bug", string content = "It does not work") =>
        new(requestId ?? Guid.NewGuid(), type, content, new SupportInquiryDiagnosticsInput("1.2.3", "45", "android", "15", "SM-S936N", "ko-KR"));

    // ---------- create ----------

    [Fact]
    public async Task Create_StoresTheInquiryUnderTheCallerWithItsDiagnostics()
    {
        var result = await NewService().CreateAsync(_userId, Command(content: "  Images are missing  "));

        Assert.True(result.Created);
        var row = await NewContext().SupportInquiries.AsNoTracking().SingleAsync(inquiry => inquiry.Id == result.Inquiry.InquiryId);
        Assert.Equal(_userId, row.UserId);
        Assert.Equal(SupportInquiryType.Bug, row.Type);
        Assert.Equal(SupportInquiryStatus.Pending, row.Status);
        Assert.Equal("Images are missing", row.Content);
        Assert.Equal(("1.2.3", "45", "android", "15", "SM-S936N", "ko-KR"), (row.AppVersion, row.BuildNumber, row.Platform, row.OsVersion, row.DeviceModel, row.Locale));
        Assert.Null(row.Answer);
        Assert.Null(row.AnsweredAtUtc);
    }

    [Fact]
    public async Task Create_PersistsTheTypeAsItsStableName()
    {
        var created = await NewService().CreateAsync(_userId, Command(type: "CollectionSharing"));

        var stored = await NewContext().Database
            .SqlQuery<string>($"SELECT [Type] AS [Value] FROM support.SupportInquiries WHERE Id = {created.Inquiry.InquiryId}")
            .SingleAsync();
        Assert.Equal("CollectionSharing", stored);
    }

    [Fact]
    public async Task Create_AtTheMaximumLength_IsStoredInFull()
    {
        var content = new string('가', SupportInquiryService.MaxContentLength);
        var created = await NewService().CreateAsync(_userId, Command(content: content));

        var read = await NewService().GetAsync(_userId, created.Inquiry.InquiryId);
        Assert.Equal(content, read.Content);
    }

    [Fact]
    public async Task Create_SameClientRequestIdAgain_ReturnsTheSameInquiryAndAddsNoRow()
    {
        var requestId = Guid.NewGuid();
        var first = await NewService().CreateAsync(_userId, Command(requestId));
        var retry = await NewService().CreateAsync(_userId, Command(requestId));

        Assert.True(first.Created);
        Assert.False(retry.Created);
        Assert.Equal(first.Inquiry.InquiryId, retry.Inquiry.InquiryId);
        Assert.Equal(1, await NewContext().SupportInquiries.CountAsync(inquiry => inquiry.UserId == _userId && inquiry.ClientRequestId == requestId));
    }

    [Fact]
    public async Task Create_ConcurrentRetriesOfOneRequest_ProduceExactlyOneRow()
    {
        var requestId = Guid.NewGuid();

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => NewService().CreateAsync(_userId, Command(requestId)))));

        Assert.Equal(1, results.Count(result => result.Created));
        Assert.Single(results.Select(result => result.Inquiry.InquiryId).Distinct());
        Assert.Equal(1, await NewContext().SupportInquiries.CountAsync(inquiry => inquiry.UserId == _userId && inquiry.ClientRequestId == requestId));
    }

    [Fact]
    public async Task Create_SameClientRequestIdByAnotherUser_IsUnrelated()
    {
        var requestId = Guid.NewGuid();
        var mine = await NewService().CreateAsync(_userId, Command(requestId));
        var theirs = await NewService().CreateAsync(_otherUserId, Command(requestId));

        Assert.True(theirs.Created);
        Assert.NotEqual(mine.Inquiry.InquiryId, theirs.Inquiry.InquiryId);
    }

    [Fact]
    public async Task Create_SameRequestIdWithADifferentQuestion_IsAConflictAndChangesNothing()
    {
        var requestId = Guid.NewGuid();
        var first = await NewService().CreateAsync(_userId, Command(requestId, content: "first"));

        await Assert.ThrowsAsync<SupportInquiryClientRequestConflictException>(
            () => NewService().CreateAsync(_userId, Command(requestId, content: "second")));
        Assert.Equal("first", (await NewService().GetAsync(_userId, first.Inquiry.InquiryId)).Content);
    }

    [Fact]
    public async Task TheDatabaseRefusesAnUnknownTypeOrStatus()
    {
        var created = await NewService().CreateAsync(_userId, Command());

        await Assert.ThrowsAnyAsync<Exception>(() => NewContext().Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE support.SupportInquiries SET [Type] = 'Nonsense' WHERE Id = {created.Inquiry.InquiryId}"));
        await Assert.ThrowsAnyAsync<Exception>(() => NewContext().Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE support.SupportInquiries SET [Status] = 'Answered' WHERE Id = {created.Inquiry.InquiryId}"));
    }

    // ---------- list / detail ----------

    [Fact]
    public async Task List_ReturnsOnlyTheCallersInquiries_NewestFirst_InPagesWithoutGapsOrRepeats()
    {
        var service = NewService();
        var mine = new List<long>();
        for (var index = 0; index < 5; index++)
        {
            mine.Add((await service.CreateAsync(_userId, Command(content: $"mine {index}"))).Inquiry.InquiryId);
        }

        var theirs = (await service.CreateAsync(_otherUserId, Command(content: "not mine"))).Inquiry.InquiryId;

        var seen = new List<long>();
        long? cursor = null;
        do
        {
            var page = await service.ListAsync(_userId, cursor, limit: 2);
            Assert.True(page.Items.Count <= 2);
            seen.AddRange(page.Items.Select(item => item.InquiryId));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        Assert.Equal(mine.AsEnumerable().Reverse(), seen);
        Assert.DoesNotContain(theirs, seen);
    }

    [Fact]
    public async Task Get_OwnInquiryIsReadable_AnotherUsersIsNotFound()
    {
        var service = NewService();
        var mine = await service.CreateAsync(_userId, Command(content: "readable"));

        Assert.Equal("readable", (await service.GetAsync(_userId, mine.Inquiry.InquiryId)).Content);
        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.GetAsync(_otherUserId, mine.Inquiry.InquiryId));
        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.GetAsync(_userId, long.MaxValue));
    }

    [Fact]
    public async Task TheUserFacingResult_CarriesNoUserIdOrDiagnostics()
    {
        var created = await NewService().CreateAsync(_userId, Command());

        var names = typeof(SupportInquiryDto).GetProperties().Select(property => property.Name).ToHashSet();
        Assert.DoesNotContain("UserId", names);
        Assert.DoesNotContain("ClientRequestId", names);
        Assert.DoesNotContain(names, name => name is "AppVersion" or "BuildNumber" or "Platform" or "OsVersion" or "DeviceModel" or "Locale");
        Assert.Equal("Pending", created.Inquiry.Status);
    }

    // ---------- answer (an internal operation: there is no HTTP route for it) ----------

    [Fact]
    public async Task Answer_MarksItAnsweredWithTheAnswerAndTime_AndTheOwnerSeesIt()
    {
        var service = NewService();
        var created = await service.CreateAsync(_userId, Command());

        await service.AnswerAsync(created.Inquiry.InquiryId, "  Fixed in the next version.  ");

        var read = await service.GetAsync(_userId, created.Inquiry.InquiryId);
        Assert.Equal("Answered", read.Status);
        Assert.Equal("Fixed in the next version.", read.Answer);
        Assert.NotNull(read.AnsweredAtUtc);
    }

    [Fact]
    public async Task Answer_AgainReplacesTheAnswer_AndAnUnknownInquiryIsNotFound()
    {
        var service = NewService();
        var created = await service.CreateAsync(_userId, Command());

        await service.AnswerAsync(created.Inquiry.InquiryId, "first");
        await service.AnswerAsync(created.Inquiry.InquiryId, "second");

        Assert.Equal("second", (await service.GetAsync(_userId, created.Inquiry.InquiryId)).Answer);
        await Assert.ThrowsAsync<SupportInquiryNotFoundException>(() => service.AnswerAsync(long.MaxValue, "x"));
    }

    // ---------- account deletion ----------

    [Fact]
    public async Task DeletingAnAccount_RemovesItsInquiries_AndNobodyElses()
    {
        var service = NewService();
        await service.CreateAsync(_userId, Command(content: "goes"));
        var kept = await service.CreateAsync(_otherUserId, Command(content: "stays"));

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_userId, $"test/support/{_userId}/", DateTimeOffset.UtcNow);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.SupportInquiries.CountAsync(inquiry => inquiry.UserId == _userId));
        Assert.Equal(1, await _db.SupportInquiries.CountAsync(inquiry => inquiry.Id == kept.Inquiry.InquiryId));
        _userIds.Remove(_userId);
    }
}
