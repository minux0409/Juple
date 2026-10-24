using Juple.Application.Notices;
using Juple.Domain.Admin;
using Juple.Domain.Notices;
using Juple.Domain.Users;
using Juple.Infrastructure.Notices;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Juple.IntegrationTests.Notices;

public sealed class NoticeIntegrationTests : IAsyncLifetime {
    private readonly List<long> users = []; private readonly List<long> notices = [];
    private long admin, alice, bob;
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-24T12:00:00Z");
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private JupleDbContext Db() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase") ?? throw new InvalidOperationException("Local test DB required")).Options);
    public async Task InitializeAsync(){
        await using var db=Db(); foreach(var ignored in Enumerable.Range(0,3)){var user=new User("ko-KR","Asia/Seoul",null,Now,Now);db.Users.Add(user);await db.SaveChangesAsync();users.Add(user.Id);}
        admin=users[0];alice=users[1];bob=users[2];db.AdminUsers.Add(new AdminUser(admin,AdminRole.Admin,null,Now));await db.SaveChangesAsync();
    }
    public async Task DisposeAsync(){await using var db=Db();
        foreach(var id in notices){var target=id.ToString(System.Globalization.CultureInfo.InvariantCulture);await db.AdminAuditLogs.Where(x=>x.TargetType=="Notice"&&x.TargetId==target&&x.AdminUserId==admin).ExecuteDeleteAsync();}
        await db.Notices.Where(x=>notices.Contains(x.Id)).ExecuteDeleteAsync();
        await db.NoticeReads.Where(x=>users.Contains(x.UserId)).ExecuteDeleteAsync();await db.AdminUsers.Where(x=>users.Contains(x.UserId)).ExecuteDeleteAsync();await db.Users.Where(x=>users.Contains(x.Id)).ExecuteDeleteAsync();
    }
    private static NoticeWrite Write(string status="Published",int platforms=7,DateTimeOffset? start=null,DateTimeOffset? end=null,bool pin=false) => new(status,true,pin,platforms,start??Now.AddDays(-1),end,null,[new("ko","공지 제목","첫 문단\n- 목록\n[도움말](https://juple.co.kr)")]);
    private async Task<AdminNotice> Create(NoticeWrite? write=null){await using var db=Db();var n=await new NoticeService(new NoticeStore(db),new Clock()).SaveAsync(admin,null,write??Write(),default);notices.Add(n.Id);return n;}
    [Theory][InlineData("Draft",7,-1,1,"web",false)][InlineData("Published",7,1,2,"web",false)][InlineData("Published",7,-2,-1,"web",false)]
    [InlineData("Published",1,-1,1,"web",true)][InlineData("Published",1,-1,1,"android",false)][InlineData("Published",2,-1,1,"android",true)]
    [InlineData("Published",4,-1,1,"ios",true)][InlineData("Published",4,-1,1,"web",false)]
    [InlineData("Published",7,0,1,"web",true)][InlineData("Published",7,-1,0,"web",false)]
    public async Task Publication_window_and_platform_are_server_filtered(string status,int platforms,int start,int end,string platform,bool visible){
        var n=await Create(Write(status,platforms,Now.AddDays(start),Now.AddDays(end)));await using var db=Db();var service=new NoticeService(new NoticeStore(db),new Clock());
        var page=await service.ListAsync(alice,platform,"ko",null,20,default);Assert.Equal(visible,page.Items.Any(x=>x.Id==n.Id));
        if(visible)Assert.Equal(n.Id,(await service.GetAsync(alice,n.Id,platform,"ko",default)).Notice.Id);
        else{await Assert.ThrowsAsync<NoticeNotFoundException>(()=>service.GetAsync(alice,n.Id,platform,"ko",default));await Assert.ThrowsAsync<NoticeNotFoundException>(()=>service.MarkReadAsync(alice,n.Id,platform,1,default));}
    }
    [Fact] public async Task Translation_falls_back_to_Korean_and_reads_sync_by_user_not_platform(){
        var n=await Create(Write() with{Translations=[new("ko","한국어","본문"),new("en","English","Body")]});await using var db=Db();var service=new NoticeService(new NoticeStore(db),new Clock());
        Assert.Equal("English",(await service.GetAsync(alice,n.Id,"web","en",default)).Notice.Title);
        Assert.Equal("한국어",(await service.GetAsync(alice,n.Id,"ios","fr",default)).Notice.Title);
        await service.MarkReadAsync(alice,n.Id,"web",1,default);
        Assert.True((await service.GetAsync(alice,n.Id,"android","en",default)).Notice.IsRead);
        Assert.False((await service.GetAsync(bob,n.Id,"web","en",default)).Notice.IsRead);
        Assert.False(await service.HasUnreadAsync(alice,"ios",default));Assert.True(await service.HasUnreadAsync(bob,"ios",default));
    }
    [Fact] public async Task Previous_api_account_deletion_cascades_only_that_users_notice_reads(){
        var n=await Create();
        await using(var db=Db()){
            var service=new NoticeService(new NoticeStore(db),new Clock());
            await service.MarkReadAsync(alice,n.Id,"web",1,default);
            await service.MarkReadAsync(bob,n.Id,"ios",1,default);
            // Simulates an older API which deletes the user without knowing NoticeReads.
            await db.Users.Where(x=>x.Id==alice).ExecuteDeleteAsync();
        }
        await using(var db=Db()){
            Assert.False(await db.NoticeReads.AnyAsync(x=>x.UserId==alice));
            Assert.True(await db.NoticeReads.AnyAsync(x=>x.UserId==bob&&x.NoticeId==n.Id));
            Assert.True(await db.Notices.AnyAsync(x=>x.Id==n.Id));
        }
    }
    public static IEnumerable<object[]> SupportedLanguages() => NoticeService.Languages.Select(language => new object[] { language });
    [Theory][MemberData(nameof(SupportedLanguages))]
    public async Task Korean_only_publication_is_visible_with_fallback_on_all_platforms(string language){
        var n=await Create();
        await using var db=Db();
        var service=new NoticeService(new NoticeStore(db),new Clock());
        foreach(var platform in new[]{"web","android","ios"}){
            var detail=await service.GetAsync(alice,n.Id,platform,language,default);
            Assert.Equal("ko",detail.Notice.Language);
            Assert.Equal("공지 제목",detail.Notice.Title);
            Assert.Equal(n.Id,Assert.Single((await service.ListAsync(alice,platform,language,null,20,default)).Items).Id);
        }
    }
    [Fact] public async Task Concurrent_reads_are_idempotent_and_create_only_one_record(){
        var n=await Create();await Task.WhenAll(Enumerable.Range(0,8).Select(async _=>{await using var db=Db();await new NoticeService(new NoticeStore(db),new Clock()).MarkReadAsync(alice,n.Id,"android",1,default);}));
        await using var verify=Db();Assert.Equal(1,await verify.NoticeReads.CountAsync(x=>x.UserId==alice&&x.NoticeId==n.Id));
    }
    [Fact] public async Task Edits_keep_reads_by_default_explicit_reset_rejects_stale_detail_and_audits_are_atomic(){
        var n=await Create();await using(var db=Db())await new NoticeService(new NoticeStore(db),new Clock()).MarkReadAsync(alice,n.Id,"web",1,default);
        await using(var db=Db())n=await new NoticeService(new NoticeStore(db),new Clock()).SaveAsync(admin,n.Id,Write() with{Version=n.Version},default);
        await using(var db=Db())Assert.True((await new NoticeService(new NoticeStore(db),new Clock()).GetAsync(alice,n.Id,"web","ko",default)).Notice.IsRead);
        await using(var db=Db())n=await new NoticeService(new NoticeStore(db),new Clock()).SaveAsync(admin,n.Id,Write() with{Version=n.Version,ResetRead=true},default);
        await using(var db=Db()){var service=new NoticeService(new NoticeStore(db),new Clock());Assert.False((await service.GetAsync(alice,n.Id,"web","ko",default)).Notice.IsRead);await Assert.ThrowsAsync<NoticeConflictException>(()=>service.MarkReadAsync(alice,n.Id,"web",1,default));await service.MarkReadAsync(alice,n.Id,"web",n.ReadVersion,default);Assert.Equal(3,await db.AdminAuditLogs.CountAsync(x=>x.TargetType=="Notice"&&x.AdminUserId==admin));}
    }
    [Fact] public async Task Revoked_or_nonadmin_write_is_denied_and_delete_is_soft(){
        var n=await Create();await using(var db=Db()){var service=new NoticeService(new NoticeStore(db),new Clock());await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SaveAsync(alice,n.Id,Write() with{Version=n.Version},default));await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.DeleteAsync(bob,n.Id,n.Version,default));await service.DeleteAsync(admin,n.Id,n.Version,default);Assert.NotNull((await db.Notices.SingleAsync(x=>x.Id==n.Id)).DeletedAtUtc);await Assert.ThrowsAsync<NoticeNotFoundException>(()=>service.GetAsync(alice,n.Id,"web","ko",default));}
    }
    [Fact] public async Task Stale_admin_version_cannot_overwrite_another_edit(){var n=await Create();await using(var db=Db())await new NoticeService(new NoticeStore(db),new Clock()).SaveAsync(admin,n.Id,Write() with{Version=n.Version,Translations=[new("ko","다른 관리자의 수정","변경된 본문")]},default);await using(var db=Db())await Assert.ThrowsAsync<NoticeConflictException>(()=>new NoticeService(new NoticeStore(db),new Clock()).SaveAsync(admin,n.Id,Write() with{Version=n.Version},default));}
    [Fact] public async Task Admin_search_status_and_stopping_publication_use_persisted_state(){
        var n=await Create(Write() with{Translations=[new("ko","검색 전용 공지","본문"),new("en","Unique notice search","Body")]});
        await using(var db=Db()){
            var service=new NoticeService(new NoticeStore(db),new Clock());
            var page=await service.AdminListAsync("Unique notice search","Published",null,20,default);
            Assert.Equal(n.Id,Assert.Single(page.Items).Id);Assert.Equal("검색 전용 공지",page.Items[0].Title);
            Assert.Empty((await service.AdminListAsync("Unique notice search","Draft",null,20,default)).Items);
            await service.SaveAsync(admin,n.Id,Write("Draft") with{Version=n.Version},default);
        }
        await using(var db=Db()){
            var service=new NoticeService(new NoticeStore(db),new Clock());
            await Assert.ThrowsAsync<NoticeNotFoundException>(()=>service.GetAsync(alice,n.Id,"web","ko",default));
            Assert.Empty((await service.ListAsync(alice,"web","ko",null,20,default)).Items);
        }
    }
    [Fact] public async Task Pinned_and_important_are_independent_and_cursor_has_no_duplicates(){
        var first=await Create(Write(start:Now.AddDays(-4),pin:true) with{IsImportant=false});var second=await Create(Write(start:Now.AddDays(-1)));var third=await Create(Write(start:Now.AddDays(-2)));
        await using var db=Db();var service=new NoticeService(new NoticeStore(db),new Clock());var a=await service.ListAsync(alice,"web","ko",null,1,default);Assert.Equal(first.Id,Assert.Single(a.Items).Id);Assert.False(a.Items[0].IsImportant);var b=await service.ListAsync(alice,"web","ko",a.NextCursor,1,default);Assert.Equal(second.Id,Assert.Single(b.Items).Id);var c=await service.ListAsync(alice,"web","ko",b.NextCursor,1,default);Assert.Equal(third.Id,Assert.Single(c.Items).Id);Assert.Null(c.NextCursor);
    }
}
