using Juple.Application.Admin;
using Juple.Domain.Analytics;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Analytics;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Analytics;

public sealed class AdminWorkspaceIntegrationTests : IAsyncLifetime
{
    private string _connection = null!;
    private readonly List<long> _ids = [];
    private static readonly AdminDateRange Range = new(new(2005,3,1), new(2005,3,7));
    private static DateTimeOffset At(int day,int hour,int minute=0) => new(2005,3,day,hour,minute,0,TimeSpan.Zero);
    private JupleDbContext Db() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connection).Options);
    public Task InitializeAsync() { _connection = LocalRetentionEnvironment.RequireConnectionString(); return Task.CompletedTask; }
    public async Task DisposeAsync() {
        await using var db = Db();
        foreach(var id in _ids) await new AccountDeletionStore(db).DeleteAllDataAsync(id,$"test/admin-workspace/{id}/",DateTimeOffset.UtcNow);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/admin-workspace/%'");
    }
    private async Task<User> User(DateTimeOffset at) {
        await using var db=Db();var user=new User("ko","Asia/Seoul",null,at,at);db.Users.Add(user);await db.SaveChangesAsync();_ids.Add(user.Id);return user;
    }
    [Fact] public async Task SQL_aggregates_respect_KST_boundaries_distinct_platform_users_trash_and_collection_membership()
    {
        var a = await User(At(1,14,59)); var b = await User(At(1,15));
        await using(var db=Db()) {
            var trash=new Item(a.Id,"https://example.org/trash",At(7,14,59));trash.SoftDelete(At(7,14,59));
            var one=new Item(a.Id,"https://Example.org/one",At(1,14,59));
            var two=new Item(a.Id,"https://example.org/two",At(1,15));
            db.Items.AddRange(one,two,trash,new Item(b.Id,"https://outside.example/future",At(7,15)));
            var c = new Collection(a.Id,"A","A",CollectionIcon.Folder,At(1,15));db.Collections.Add(c);await db.SaveChangesAsync();
            db.CollectionItems.AddRange(CollectionItem.CreateNew(c.Id,one.Id,a.Id,At(1,15),0),CollectionItem.CreateNew(c.Id,two.Id,a.Id,At(1,15),1));await db.SaveChangesAsync();
            var device=new PushDeviceRegistration(a.Id,PushPlatform.Android,Guid.NewGuid().ToString(),"local-fixture-only","ko",At(1,0),At(1,0));
            var note=Notification.Social(a.Id,NotificationType.CollectionItemCommentReceived,b.Id,c.Id,one.Id,Guid.NewGuid().ToString(),At(1,14,59));
            db.PushDeviceRegistrations.Add(device);db.Notifications.Add(note);
            db.NotificationEvents.Add(new NotificationEvent(NotificationType.CollectionItemsAdded,a.Id,null,c.Id,null,2,false,null,Guid.NewGuid().ToString(),At(1,15)));
            await db.SaveChangesAsync();
            db.NotificationDeliveries.Add(new NotificationDelivery(note.Id,device.Id,NotificationDeliveryStatus.Sent,2,At(1,15),"fixture-message",null));await db.SaveChangesAsync();
            var store=new UserActivityStore(db,new AdminWorkspaceOptions {Enabled=true});
            await store.RecordAsync(a.Id,new(2005,3,1),ClientPlatform.Android,null,At(1,14,59));
            await store.RecordAsync(a.Id,new(2005,3,1),ClientPlatform.Android,null,At(1,15));
            await store.RecordAsync(a.Id,new(2005,3,1),ClientPlatform.Web,null,At(1,15));
            await store.RecordAsync(b.Id,new(2005,3,7),ClientPlatform.Ios,null,At(7,14,59));
        }
        await using var read=Db();var result=await new AdminWorkspaceStore(read).OverviewAsync(Range,At(7,14,59),default);
        Assert.Equal(7,result.Series.Count);Assert.Equal(2,result.NewUsers);Assert.Equal(3,result.SavedLinks);Assert.Equal(1,result.UniqueSavers);
        Assert.Equal(1,result.Series[0].Signups);Assert.Equal(1,result.Series[1].Signups);Assert.Equal(1,result.Series[1].CollectionsCreated);
        Assert.Equal(0,result.Series[2].LinksSaved);Assert.Equal(2,result.ActiveUsers);
        Assert.Equal(1,result.Dau);Assert.Equal(2,result.Wau);Assert.Equal(2,result.Mau);
        Assert.Equal(1,result.Platforms.Single(x=>x.Platform=="Android").ActiveUsers);Assert.Equal(1,result.Platforms.Single(x=>x.Platform=="Web").ActiveUsers);
        Assert.Equal(1,result.Platforms.Single(x=>x.Platform=="Ios").ActiveUsers);Assert.Equal(0,result.Platforms.Single(x=>x.Platform=="Unknown").ActiveUsers);
        Assert.Equal(3,result.Domains.Single(x=>x.Domain=="example.org").Links);Assert.DoesNotContain(result.Domains,x=>x.Domain=="outside.example");
        Assert.Equal(2,result.RecentUsers.Count);Assert.False(result.Coverage.Single(x=>x.Metric=="deletedUsers").Available);
        var operations=await new AdminWorkspaceStore(read).OperationsAsync(Range,default);
        Assert.Equal(1,operations.Push.Sum(x=>x.Deliveries));
        var sent=Assert.Single(operations.Push,x=>x.Deliveries>0);Assert.Equal("Android",sent.Platform);Assert.Equal("Sent",sent.Status);
        Assert.Equal(new DateOnly(2005,3,2),sent.Date);Assert.Equal(60_000d,sent.AverageCreationToAttemptMs);
        Assert.Single(operations.Events);Assert.Equal(1,result.Series[1].SharedLinkAddEvents);
        var revenue=await new AdminWorkspaceStore(read).RevenueAsync(false,default);Assert.False(revenue.AmountsAvailable);Assert.False(revenue.BillingProgramEnabled);
    }
    [Fact] public async Task KST_upsert_is_concurrent_safe_monotonic_and_OFF_does_not_write_new_buckets()
    {
        var user=await User(At(1,0));
        async Task Write(int n) { await using var db=Db();await new UserActivityStore(db,new(){Enabled=true}).RecordAsync(user.Id,new(2005,3,1),ClientPlatform.Android,null,At(1,15,n)); }
        await Task.WhenAll(Enumerable.Range(0,8).Select(Write));
        await using var read=Db();var row=await read.UserDailyActivitiesKst.SingleAsync(x=>x.UserId==user.Id);
        Assert.Equal(new DateOnly(2005,3,2),row.Date);Assert.Equal(At(1,15,7),row.LastSeenAtUtc);
        await new UserActivityStore(read).RecordAsync(user.Id,new(2005,3,7),ClientPlatform.Unknown,null,At(7,15));
        Assert.Equal(1,await read.UserDailyActivitiesKst.CountAsync(x=>x.UserId==user.Id));
        await new AccountDeletionStore(read).DeleteAllDataAsync(user.Id,$"test/admin-workspace/{user.Id}/",DateTimeOffset.UtcNow);
        Assert.False(await read.UserDailyActivitiesKst.AnyAsync(x=>x.UserId==user.Id));_ids.Remove(user.Id);
    }
}
