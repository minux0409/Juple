using Juple.Application.Admin;
using Juple.Application.Notices;
using Juple.Application.Support;
using Juple.Application.Translation;
using Juple.Domain.Admin;
using Juple.Domain.Items;
using Juple.Domain.Notices;
using Juple.Domain.Support;
using Juple.Domain.Users;
using Juple.Infrastructure.Admin;
using Juple.Infrastructure.Analytics;
using Juple.Infrastructure.Notices;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Admin;

/// <summary>
/// Admin V2 against the real SQL Server schema: the dashboard numbers and charts agree, the user table and one person's history,
/// the inquiry translation workflow on the existing row (and its duplicate-send guard), and notice translation origins.
/// Integration tests run one at a time (AssemblyConfiguration), so global counts are compared as deltas.
/// </summary>
public sealed class AdminV2IntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private readonly List<long> _userIds = [];
    private readonly List<long> _noticeIds = [];

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run the integration tests against a local SQL Server.");
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        foreach (var id in _noticeIds)
        {
            await db.Notices.Where(n => n.Id == id).ExecuteDeleteAsync();
        }

        foreach (var userId in _userIds)
        {
            await db.AdminAuditLogs.Where(log => log.AdminUserId == userId).ExecuteDeleteAsync();
            await new AccountDeletionStore(db).DeleteAllDataAsync(userId, $"test/admin-v2/{userId}/", DateTimeOffset.UtcNow);
        }

        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/admin-v2/%'");
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<User> NewUserAsync(DateTimeOffset createdAtUtc, string locale = "ko-KR")
    {
        await using var db = NewContext();
        var user = new User(locale, "Asia/Seoul", null, createdAtUtc, createdAtUtc);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user;
    }

    private async Task<Item> NewItemAsync(long userId, DateTimeOffset savedAtUtc, DateTimeOffset? trashedAtUtc = null)
    {
        await using var db = NewContext();
        var item = new Item(userId, "https://example.com/admin-v2/" + Guid.NewGuid().ToString("N"), savedAtUtc);
        if (trashedAtUtc is { } trashed)
        {
            item.SoftDelete(trashed);
        }

        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    // Stored instants are UTC (offset zero), as everywhere in Juple; the wall-clock time is given in Seoul.
    private static DateTimeOffset Seoul(int year, int month, int day, int hour = 12) => new DateTimeOffset(year, month, day, hour, 0, 0, TimeSpan.FromHours(9)).ToUniversalTime();

    [Fact]
    public async Task TheLastPointOfEachChart_IsExactlyItsDashboardNumber()
    {
        var now = DateTimeOffset.UtcNow;
        var user = await NewUserAsync(now.AddMinutes(-5));
        await NewItemAsync(user.Id, now.AddMinutes(-4));
        await NewItemAsync(user.Id, now.AddMinutes(-3), trashedAtUtc: now.AddMinutes(-2));
        await using var db = NewContext();
        var store = new AdminInsightsStore(db);
        var period = AdminDateRange.Resolve("30d", null, null, now);

        var kpis = await store.KpisAsync(now);
        var users = await store.SeriesAsync("users", period, now);
        var links = await store.SeriesAsync("links", period, now);
        var signups = await store.SeriesAsync("signups", period, now);

        Assert.Equal(30, users.Points.Count);
        Assert.Equal(kpis.TotalUsers, users.Points[^1].Value);
        Assert.Equal(kpis.LiveLinks, links.Points[^1].Value);
        Assert.Equal(kpis.TodaySignups, signups.Points[^1].Value);
        Assert.Equal(await db.Items.CountAsync(item => item.DeletedAtUtc == null), kpis.LiveLinks);
        Assert.True(kpis.TodaySignups >= 1);
    }

    [Fact]
    public async Task ThePastLinkCurve_TakesTheTrashIntoAccountOnTheDayItHappened()
    {
        var user = await NewUserAsync(Seoul(2026, 3, 1));
        await using (var db = NewContext())
        {
            var store = new AdminInsightsStore(db);
            var period = new AdminDateRange(new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 5));
            var before = await store.SeriesAsync("links", period, DateTimeOffset.UtcNow);

            await NewItemAsync(user.Id, Seoul(2026, 3, 2));
            await NewItemAsync(user.Id, Seoul(2026, 3, 2, 23), trashedAtUtc: Seoul(2026, 3, 4, 0));

            var after = await store.SeriesAsync("links", period, DateTimeOffset.UtcNow);
            var deltas = after.Points.Zip(before.Points, (a, b) => a.Value - b.Value).ToArray();
            // 3/1: nothing yet; 3/2 and 3/3: both links held; from 3/4 the trashed one is gone.
            Assert.Equal([0, 2, 2, 1, 1], deltas);
        }
    }

    [Fact]
    public async Task OnePersonsHistory_StartsOnTheirSeoulSignupDay_AndCountsEveryDay()
    {
        // 2026-04-01 23:30 KST is still April 1st in Seoul (14:30 UTC).
        var user = await NewUserAsync(Seoul(2026, 4, 1, 23).AddMinutes(30));
        await NewItemAsync(user.Id, Seoul(2026, 4, 1, 23).AddMinutes(40));
        await NewItemAsync(user.Id, Seoul(2026, 4, 3));
        await NewItemAsync(user.Id, Seoul(2026, 4, 3, 13), trashedAtUtc: Seoul(2026, 4, 5));
        await using var db = NewContext();
        var store = new AdminInsightsStore(db);
        var now = Seoul(2026, 4, 5, 18);

        var daily = (await store.UserLinkHistoryAsync(user.Id, monthly: false, now))!;
        var monthly = (await store.UserLinkHistoryAsync(user.Id, monthly: true, now))!;

        Assert.Equal(new DateOnly(2026, 4, 1), daily.SignupDate);
        Assert.Equal("day", daily.Granularity);
        Assert.Equal([1, 0, 2, 0, 0], daily.Buckets.Select(bucket => bucket.Saved).ToArray());
        Assert.Equal([1, 1, 3, 3, 3], daily.Buckets.Select(bucket => bucket.CumulativeSaved).ToArray());
        // Saved since sign-up (3) is not what the person holds now (2: one link is in the trash).
        Assert.Equal((3, 2), (daily.SavedSinceSignup, daily.LiveLinks));
        Assert.Equal(("month", new DateOnly(2026, 4, 1), 3), (monthly.Granularity, Assert.Single(monthly.Buckets).Start, monthly.Buckets[0].Saved));
        Assert.Null(await store.UserLinkHistoryAsync(-1, false, now));
    }

    [Fact]
    public async Task TheUserTable_SearchesSortsFiltersAndCountsLiveLinks()
    {
        var marker = "v2-" + Guid.NewGuid().ToString("N")[..8];
        var a = await NewUserAsync(DateTimeOffset.UtcNow.AddDays(-2), "ja-JP");
        var b = await NewUserAsync(DateTimeOffset.UtcNow.AddDays(-1), "ja");
        await using (var db = NewContext())
        {
            await db.Users.Where(user => user.Id == a.Id).ExecuteUpdateAsync(set => set.SetProperty(user => user.DisplayName, marker + " 하나"));
            await db.Users.Where(user => user.Id == b.Id).ExecuteUpdateAsync(set => set.SetProperty(user => user.DisplayName, marker + " 둘"));
        }

        await NewItemAsync(a.Id, DateTimeOffset.UtcNow);
        await NewItemAsync(a.Id, DateTimeOffset.UtcNow);
        await NewItemAsync(a.Id, DateTimeOffset.UtcNow, trashedAtUtc: DateTimeOffset.UtcNow);
        await NewItemAsync(b.Id, DateTimeOffset.UtcNow);

        await using var context = NewContext();
        var service = new AdminInsightsService(new AdminInsightsStore(context), TimeProvider.System);
        var byLinks = await service.UsersAsync(marker, "nickname", "ja", "linksDesc", 1, 20);
        var byCreated = await service.UsersAsync(marker, "nickname", null, "createdAsc", 1, 1);
        var byId = await service.UsersAsync("@" + b.PublicCode[..4].ToLowerInvariant(), "jupleId", null, null, 1, 100);

        Assert.Equal([(a.Id, 2, "ja"), (b.Id, 1, "ja")], byLinks.Items.Select(row => (row.UserId, row.LinkCount, row.Language)).ToArray());
        Assert.Equal(2, byCreated.Total);
        Assert.Equal(a.Id, Assert.Single(byCreated.Items).UserId);
        Assert.Contains(byId.Items, row => row.UserId == b.Id);
        Assert.Contains(byLinks.Languages, language => language.Language == "ja" && language.Users >= 2);
        Assert.Empty((await service.UsersAsync(marker, "nickname", "ko", null, 1, 20)).Items);
    }

    [Fact]
    public async Task TheInquiryWorkflow_KeepsTheOriginal_SendsOnce_AndRefusesAStaleSend()
    {
        var user = await NewUserAsync(DateTimeOffset.UtcNow, "en-US");
        var admin = await NewUserAsync(DateTimeOffset.UtcNow);
        long inquiryId;
        await using (var db = NewContext())
        {
            var inquiry = new SupportInquiry(user.Id, Guid.NewGuid(), SupportInquiryType.Bug, "The app freezes when I save",
                new SupportInquiryDiagnostics("1.0", "36", "android", "16", "SM-S936N", "en-US"), DateTimeOffset.UtcNow);
            db.SupportInquiries.Add(inquiry);
            db.AdminUsers.Add(new AdminUser(admin.Id, AdminRole.Owner, null, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
            inquiryId = inquiry.Id;
        }

        AdminInquiryWorkflowService Workflow(JupleDbContext db) => new(
            new AdminService(new AdminDashboardStore(db), new AdminUserDirectoryStore(db), new AdminSupportInquiryStore(db), TimeProvider.System),
            new AdminSupportInquiryStore(db),
            new FixedTranslator(),
            new TranslationOptions { Provider = TranslationOptions.ProviderAzure, AllowInquiryTranslation = true, AzureTranslator = { Key = "k", Region = "r" } },
            TimeProvider.System);

        await using (var db = NewContext())
        {
            var translated = await Workflow(db).TranslateContentAsync(inquiryId);
            Assert.Equal("The app freezes when I save", translated.Content);
            Assert.Equal(("en", "[ko] The app freezes when I save"), (translated.ContentTranslation!.Language, translated.ContentTranslation.TextKo));
            Assert.Equal("en", translated.SuggestedLanguage);

            var drafted = await Workflow(db).SaveDraftAsync(inquiryId, new("수정했습니다", "We fixed it", "en"));
            Assert.Equal(("수정했습니다", "We fixed it", "en"), (drafted.AnswerDraft!.SourceKo, drafted.AnswerDraft.Translated, drafted.AnswerDraft.Language));
            Assert.Null(drafted.Answer);
            Assert.Equal("Pending", drafted.Status);
        }

        DateTimeOffset? loadedAt;
        await using (var db = NewContext())
        {
            loadedAt = (await Workflow(db).SaveDraftAsync(inquiryId, new("수정했습니다", "We fixed it", "en"))).ChangeToken;
            var sent = await Workflow(db).SendAnswerAsync(admin.Id, inquiryId, "We fixed it", "수정했습니다", "en", loadedAt);
            Assert.Equal(("Answered", "We fixed it", "수정했습니다", "en"), (sent.Status, sent.Answer, sent.AnswerSourceKo, sent.AnswerLanguage));
            Assert.Null(sent.AnswerDraft);
        }

        await using (var db = NewContext())
        {
            // The same send again (a double click / a retry) writes nothing - one audit record only.
            await Workflow(db).SendAnswerAsync(admin.Id, inquiryId, "We fixed it", "수정했습니다", "en", loadedAt);
            // A different answer from a page loaded before the first send is refused.
            await Assert.ThrowsAsync<AdminInquiryChangedException>(() => Workflow(db).SendAnswerAsync(admin.Id, inquiryId, "Other", "다른 답변", "en", loadedAt));
            Assert.Equal(1, await db.AdminAuditLogs.CountAsync(log => log.TargetType == AdminAuditTargets.SupportInquiry
                && log.TargetId == inquiryId.ToString() && log.Action == AdminAuditActions.SupportInquiryAnswered));
            var row = await db.SupportInquiries.AsNoTracking().SingleAsync(x => x.Id == inquiryId);
            Assert.Equal(("The app freezes when I save", "We fixed it"), (row.Content, row.Answer));
        }

        // What the person reads in 고객센터 is the delivered (translated) answer.
        await using (var db = NewContext())
        {
            var mine = await new SupportInquiryService(new Juple.Infrastructure.Support.SupportInquiryStore(db), TimeProvider.System).GetAsync(user.Id, inquiryId);
            Assert.Equal("We fixed it", mine.Answer);
        }
    }

    [Fact]
    public async Task NoticeTranslations_KeepTheirOriginAndSourceFingerprint()
    {
        var admin = await NewUserAsync(DateTimeOffset.UtcNow);
        await using var db = NewContext();
        db.AdminUsers.Add(new AdminUser(admin.Id, AdminRole.Owner, null, DateTimeOffset.UtcNow));
        await db.SaveChangesAsync();
        var fingerprint = NoticeService.SourceFingerprint("점검 안내", "내일 점검합니다");
        var service = new NoticeService(new NoticeStore(db), TimeProvider.System);

        var saved = await service.SaveAsync(admin.Id, null, new NoticeWrite("Draft", false, false, 7, DateTimeOffset.UtcNow, null, null,
            [new("ko", "점검 안내", "내일 점검합니다"), new("en", "Maintenance", "Tomorrow", "Machine", fingerprint), new("ja", "点検", "明日", "Manual")]), CancellationToken.None);
        _noticeIds.Add(saved.Id);

        Assert.Equal(fingerprint, saved.SourceFingerprint);
        var origins = saved.Translations.ToDictionary(t => t.Language, t => (t.Origin, t.SourceFingerprint));
        Assert.Equal(("Source", (string?)null), origins["ko"]);
        Assert.Equal(("Machine", fingerprint), origins["en"]);
        Assert.Equal(("Manual", (string?)null), origins["ja"]);
        Assert.All(saved.Translations, t => Assert.NotNull(t.TranslatedAtUtc));

        // After the Korean original changes, the stored machine translation's fingerprint no longer matches the notice's.
        var edited = await service.SaveAsync(admin.Id, saved.Id, new NoticeWrite("Draft", false, false, 7, saved.StartsAtUtc, null, null,
            [new("ko", "점검 안내", "모레 점검합니다"), new("en", "Maintenance", "Tomorrow", "Machine", fingerprint), new("ja", "点検", "明日", "Manual")], saved.Version), CancellationToken.None);
        Assert.NotEqual(edited.SourceFingerprint, edited.Translations.Single(t => t.Language == "en").SourceFingerprint);
    }

    /// <summary>Stands in for the provider: "[target] text", detecting English.</summary>
    private sealed class FixedTranslator : ITextTranslator
    {
        public string ProviderName => "Fixed";

        public bool IsConfigured => true;

        public Task<TranslationResult> TranslateAsync(TranslationRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(new TranslationResult(request.Texts.Select(text => $"[{request.TargetLanguage}] {text}").ToArray(), request.SourceLanguage is null ? "en" : null));
    }
}
