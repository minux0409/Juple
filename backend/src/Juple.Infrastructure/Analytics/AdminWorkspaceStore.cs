using Juple.Application.Admin;
using Juple.Domain.Analytics;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Analytics;

/// <summary>Bounded SQL aggregates; no link contents, Push tokens or billing handles leave this store.</summary>
public sealed class AdminWorkspaceStore(JupleDbContext db) : IAdminWorkspaceStore
{
    public async Task<WorkspaceOverview> OverviewAsync(AdminDateRange p, DateTimeOffset now, CancellationToken ct)
    {
        var start = p.StartUtc; var end = p.EndExclusiveUtc;
        var users = db.Users.AsNoTracking();
        var total = await users.CountAsync(ct);
        var beforeUsers = await users.CountAsync(x => x.CreatedAtUtc < start, ct);
        var signups = await users.Where(x => x.CreatedAtUtc >= start && x.CreatedAtUtc < end)
            .GroupBy(x => x.CreatedAtUtc.AddHours(9).Date).Select(g => new { Date = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Date), x => x.Count, ct);
        var items = db.Items.AsNoTracking();
        var live = await items.CountAsync(x => x.DeletedAtUtc == null, ct);
        var beforeItems = await items.CountAsync(x => x.SavedAtUtc < start, ct);
        var saved = items.Where(x => x.SavedAtUtc >= start && x.SavedAtUtc < end);
        var savers = await saved.Select(x => x.UserId).Distinct().CountAsync(ct);
        var saves = await saved.GroupBy(x => x.SavedAtUtc.AddHours(9).Date)
            .Select(g => new { Date = g.Key, Count = g.Count(), Savers = g.Select(x => x.UserId).Distinct().Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Date), ct);
        var collections = await db.Collections.AsNoTracking().Where(x => x.CreatedAtUtc >= start && x.CreatedAtUtc < end)
            .GroupBy(x => x.CreatedAtUtc.AddHours(9).Date).Select(g => new { Date = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Date), x => x.Count, ct);
        var social = await db.NotificationEvents.AsNoTracking().Where(x => x.CreatedAtUtc >= start && x.CreatedAtUtc < end)
            .GroupBy(x => new { Date = x.CreatedAtUtc.AddHours(9).Date, x.Type })
            .Select(g => new { g.Key.Date, g.Key.Type, Count = g.Count() }).ToListAsync(ct);
        int Events(DateOnly date, Juple.Domain.Notifications.NotificationType type) => social
            .Where(x => DateOnly.FromDateTime(x.Date) == date && x.Type == type).Sum(x => x.Count);
        var activity = db.UserDailyActivitiesKst.AsNoTracking();
        var since = await activity.Select(x => (DateOnly?)x.Date).MinAsync(ct);
        var inPeriod = activity.Where(x => x.Date >= p.From && x.Date <= p.Through);
        var activeDays = await inPeriod.GroupBy(x => x.Date).Select(g => new { Date = g.Key, Count = g.Select(x => x.UserId).Distinct().Count() })
            .ToDictionaryAsync(x => x.Date, x => x.Count, ct);
        var platforms = await inPeriod.GroupBy(x => x.Platform).Select(g => new { Platform = g.Key, Count = g.Select(x => x.UserId).Distinct().Count() })
            .ToDictionaryAsync(x => x.Platform, x => x.Count, ct);
        async Task<int?> Active(DateOnly from) => since is null || p.Through < since ? null
            : await activity.Where(x => x.Date >= from && x.Date <= p.Through).Select(x => x.UserId).Distinct().CountAsync(ct);
        var recent = await (from a in inPeriod.GroupBy(x => x.UserId).Select(g => new { UserId = g.Key, Seen = g.Max(x => x.LastSeenAtUtc) })
                            join u in users on a.UserId equals u.Id
                            orderby a.Seen descending, u.Id
                            select new WorkspaceRecentUser(u.PublicCode, a.Seen)).Take(10).ToListAsync(ct);
        var series = new List<WorkspaceDay>(p.Days);
        var cumulativeUsers = beforeUsers; var cumulativeLinks = beforeItems;
        for (var day = p.From; day <= p.Through; day = day.AddDays(1))
        {
            var joined = signups.GetValueOrDefault(day); var count = saves.GetValueOrDefault(day)?.Count ?? 0;
            cumulativeUsers += joined; cumulativeLinks += count;
            series.Add(new(day, joined, cumulativeUsers, count, saves.GetValueOrDefault(day)?.Savers ?? 0, cumulativeLinks,
                collections.GetValueOrDefault(day), since is null || day < since ? null : activeDays.GetValueOrDefault(day),
                Events(day, Juple.Domain.Notifications.NotificationType.CollectionItemsAdded),
                Events(day, Juple.Domain.Notifications.NotificationType.CollectionLinkShared),
                Events(day, Juple.Domain.Notifications.NotificationType.CollectionItemCommentReceived)));
        }
        // Extract only the authority inside SQL. No URLs/titles/memos are loaded into the dashboard process.
        var domains = await db.Database.SqlQuery<DomainRow>($"""
            SELECT TOP (10) LOWER([a].[Host]) AS [Domain], COUNT(*) AS [Links]
            FROM [items].[Items] AS [i]
            CROSS APPLY (SELECT SUBSTRING([i].[Url], CHARINDEX('://',[i].[Url])+3, 2048) AS [Rest]) [r]
            CROSS APPLY (SELECT LEFT([r].[Rest], PATINDEX('%[/?#]%', [r].[Rest]+'/')-1) AS [Host]) [a]
            WHERE [i].[SavedAtUtc]>={start} AND [i].[SavedAtUtc]<{end}
              AND CHARINDEX('://',[i].[Url])>0 AND CHARINDEX('@',[a].[Host])=0 AND LEN([a].[Host]) BETWEEN 1 AND 253
            GROUP BY LOWER([a].[Host]) ORDER BY COUNT(*) DESC, LOWER([a].[Host])
            """).ToListAsync(ct);
        var currentCollections = db.Collections.AsNoTracking().Where(x => x.DeletedAtUtc == null);
        var collectionCount = await currentCollections.CountAsync(ct);
        var sharedCount = await currentCollections.CountAsync(x => db.CollectionCollaborators.Any(c => c.CollectionId == x.Id)
            || db.CollectionShares.Any(s => s.CollectionId == x.Id && s.IsActive && s.IsPublic), ct);
        var openInquiries = await db.SupportInquiries.CountAsync(x => x.Status == Juple.Domain.Support.SupportInquiryStatus.Pending
            || x.Status == Juple.Domain.Support.SupportInquiryStatus.InProgress, ct);
        return new(p, "Asia/Seoul", now, total, signups.Values.Sum(), live, series.Sum(x => x.LinksSaved), savers,
            await Active(p.From), await Active(p.Through), await Active(p.Through.AddDays(-6)), await Active(p.Through.AddDays(-29)), since,
            series, Enum.GetValues<ClientPlatform>().Select(x => new WorkspacePlatform(x.ToString(), platforms.GetValueOrDefault(x))).ToArray(),
            recent, domains.Select(x => new WorkspaceDomain(x.Domain, x.Links)).ToArray(),
            [new("activity", since is not null, "KST 수집 시작 이후 관측값. UTC 일별 집계를 임의 변환하지 않으며 DAU/WAU/MAU는 선택 종료일 기준입니다."),
             new("signupPlatform", false, "가입 플랫폼은 저장하지 않습니다. 플랫폼 표는 기간 내 실제 활동 사용자이며 여러 플랫폼 사용자는 각 플랫폼에 중복 포함됩니다."),
             new("deletedUsers", false, "탈퇴 계정과 활동은 제거되므로 과거 탈퇴 수/실제 누적 가입자는 복원할 수 없습니다."),
             new("historicalHoldings", false, "누적 그래프는 현재 남아있는 행의 생성일 기준입니다. 과거 실제 보유량이 아니며 휴지통 포함, 영구삭제 제외입니다. 현재 보유량은 휴지통 제외입니다."),
             new("collaboration", true, "보관 중인 NotificationEvent의 유형별 생성 건수입니다. 수신자별 delivery 수와 다르며, Bulk/병합 이벤트를 실제 작업 수나 추가 링크 수로 환산하지 않습니다. 삭제된 과거 이벤트는 제외됩니다."),
             new("saves", true, "사용자 소유 Item 행마다 1건. 중복 URL 저장은 각각 집계, CollectionItem 연결은 재집계하지 않습니다. 도메인은 포트가 있으면 포함합니다.")])
        { CurrentCollections = collectionCount, SharedCollections = sharedCount, OpenInquiries = openInquiries };
    }

    public async Task<WorkspaceOperations> OperationsAsync(AdminDateRange p, CancellationToken ct)
    {
        var start = p.StartUtc; var end = p.EndExclusiveUtc;
        var groups = await (from d in db.NotificationDeliveries.AsNoTracking()
                            join device in db.PushDeviceRegistrations.AsNoTracking() on d.PushDeviceRegistrationId equals device.Id
                            join n in db.Notifications.AsNoTracking() on d.NotificationId equals n.Id
                            where d.AttemptedAtUtc >= start && d.AttemptedAtUtc < end
                            group new { d, n } by new { Date = d.AttemptedAtUtc.AddHours(9).Date, device.Platform, d.Status } into g
                            select new { g.Key.Date, g.Key.Platform, g.Key.Status, Count = g.Count(),
                                Delay = g.Average(x => (double?)EF.Functions.DateDiffSecond(x.n.CreatedAtUtc, x.d.AttemptedAtUtc)) }).ToListAsync(ct);
        var output = new List<WorkspacePushDay>();
        foreach (var date in Enumerable.Range(0, p.Days).Select(x => p.From.AddDays(x)))
        foreach (var platform in Enum.GetValues<Juple.Domain.Push.PushPlatform>())
        foreach (var status in Enum.GetValues<Juple.Domain.Notifications.NotificationDeliveryStatus>())
        {
            var row = groups.FirstOrDefault(x => DateOnly.FromDateTime(x.Date) == date && x.Platform == platform && x.Status == status);
            output.Add(new(date, platform.ToString(), status.ToString(), row?.Count ?? 0, row?.Delay * 1000));
        }
        var events = await db.NotificationEvents.AsNoTracking().Where(x => x.CreatedAtUtc >= start && x.CreatedAtUtc < end)
            .OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id).Take(20)
            .Select(x => new WorkspaceEvent(x.CreatedAtUtc, x.Type.ToString(), x.Status.ToString(), x.AttemptCount)).ToListAsync(ct);
        return new(p, output, events,
            [new("push", true, "보관 중인 알림-기기 delivery 행의 마지막 시도 상태입니다. 재시도 전체 이력이나 실제 단말 수신 수가 아닙니다. 삭제된 기기/계정의 이력은 빠질 수 있습니다."),
             new("delay", true, "알림 생성부터 마지막 시도까지의 평균 초입니다. 순수 큐 지연이나 단말 수신 지연이 아닙니다."),
             new("apiErrors", false, "Azure Monitor 조회 Adapter/읽기 권한 연결 전입니다. 0건으로 간주하지 않습니다."),
             new("loginFailures", false, "Entra 로그인 실패 로그가 연결되지 않았습니다. API 401을 로그인 실패로 추정하지 않습니다.")]);
    }

    public async Task<WorkspaceRevenue> RevenueAsync(bool billingEnabled, CancellationToken ct) =>
        new(billingEnabled, await db.StorePurchases.AsNoTracking().GroupBy(x => new { x.Source, x.State })
            .Select(g => new WorkspacePurchaseState(g.Key.Source.ToString(), g.Key.State.ToString(), g.Count())).ToListAsync(ct), false,
            "현재 Billing에는 구매의 최신 권한 상태만 있고 결제·갱신 거래별 금액/통화/수수료/정산 이력이 없습니다. 실제 매출과 순손익은 집계 불가이며 $1.99 × 사용자 수로 추정하지 않습니다. iOS/Web 매출 자료도 없습니다.");

    private sealed class DomainRow { public string Domain { get; set; } = ""; public int Links { get; set; } }
}
