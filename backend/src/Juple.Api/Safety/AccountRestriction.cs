using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Juple.Api.Safety;

/// <summary>
/// 계정 이용 제한 (an operator's decision after reviewing a report): a restricted person keeps reading, signing in, seeing their notices,
/// contacting support, blocking / reporting, exporting and deleting their own data - but every other CHANGE (POST / PUT / PATCH / DELETE) is
/// refused with 403 <c>accountRestricted</c>. Registered as a global filter; anonymous requests and safe methods are never touched. One indexed
/// primary-key lookup per write, deliberately not cached, so lifting (or setting) the restriction takes effect on the next request.
/// </summary>
public sealed class AccountRestrictionFilter(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IModerationNoticeStore noticeStore) : IAsyncActionFilter
{
    public const string Code = "accountRestricted";

    private static readonly string[] AllowedPrefixes =
    [
        "/api/v1/users/", "/api/v1/account", "/api/v1/auth/", "/api/v1/notifications", "/api/v1/push/", "/api/v1/support/", "/api/v1/moderation-notices",
        "/api/v1/data-export", "/api/v1/billing", "/api/v1/terms", "/api/v1/admin",
    ];

    public static bool IsAllowedWhileRestricted(string method, string path)
    {
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            return true;
        }

        return AllowedPrefixes.Any(prefix => path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            || path.Contains("/reports", StringComparison.OrdinalIgnoreCase);
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        if (context.HttpContext.User.Identity?.IsAuthenticated != true || IsAllowedWhileRestricted(request.Method, request.Path.Value ?? string.Empty))
        {
            await next();
            return;
        }

        try
        {
            var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), context.HttpContext.RequestAborted);
            if (await noticeStore.IsUsageRestrictedAsync(user.UserId, context.HttpContext.RequestAborted))
            {
                context.Result = SafetyProblems.Create(
                    StatusCodes.Status403Forbidden, "This account's use is restricted. You can still read your data and contact support.", Code);
                return;
            }
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // Not bootstrapped yet: the action itself answers that, as before.
        }

        await next();
    }
}
