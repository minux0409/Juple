using Juple.Application.Notices;
using Juple.Api.Authentication;
using Juple.Api.Controllers;
using Juple.Api.Controllers.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace Juple.UnitTests.Notices;
public sealed class NoticeTests {
    private static NoticeWrite Valid()=>new("Published",true,false,7,DateTimeOffset.UtcNow,null,"https://juple.co.kr/help",[new("ko","제목","본문")]);
    [Fact] public void Admin_API_uses_the_real_server_admin_policy_and_no_user_id_body(){
        Assert.Equal(AuthorizationPolicies.JupleAdmin,Assert.Single(typeof(AdminNoticesController).GetCustomAttributes(typeof(AuthorizeAttribute),true).Cast<AuthorizeAttribute>()).Policy);
        Assert.Equal(AuthorizationPolicies.JupleUser,Assert.Single(typeof(NoticesController).GetCustomAttributes(typeof(AuthorizeAttribute),true).Cast<AuthorizeAttribute>()).Policy);
        Assert.DoesNotContain(typeof(NoticesController.ReadRequest).GetProperties(),x=>x.Name=="UserId");
        Assert.True(typeof(NoticesController).GetCustomAttributes(typeof(ResponseCacheAttribute),true).Cast<ResponseCacheAttribute>().Single().NoStore);
    }
    [Theory][InlineData("javascript:alert(1)")][InlineData("http://juple.co.kr")][InlineData("https://user:pass@juple.co.kr")]
    public void Official_URL_requires_safe_HTTPS(string url)=>Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{OfficialUrl=url}));
    [Theory][InlineData(0)][InlineData(8)][InlineData(-1)] public void Platforms_validated(int value)=>Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{Platforms=value}));
    [Fact] public void Korean_is_required_and_duplicate_languages_are_invalid(){
        Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{Translations=[new("en","Title","Body")]}));
        Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{Translations=[new("ko","제목","본문"),new("ko","중복","중복")]}));
        Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{Translations=[new("ko","제목",new string('x',20001))]}));
        Assert.Throws<InvalidNoticeException>(()=>NoticeService.Validate(Valid() with{EndsAtUtc=DateTimeOffset.MinValue}));
    }
    [Fact] public void All_17_languages_and_platforms_are_supported(){Assert.Equal(17,NoticeService.Languages.Length);Assert.Equal("ko",NoticeService.Language("unknown"));Assert.Equal("zh-Hans",NoticeService.Language("ZH-HANS"));Assert.Throws<InvalidNoticeException>(()=>NoticeService.Platform("all"));NoticeService.Validate(Valid());}
}
