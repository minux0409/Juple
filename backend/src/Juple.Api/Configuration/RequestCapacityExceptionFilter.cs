using Microsoft.AspNetCore.Mvc.Filters;

namespace Juple.Api.Configuration;

public sealed class RequestCapacityExceptionFilter : IAsyncExceptionFilter
{
    public async Task OnExceptionAsync(ExceptionContext context)
    {
        if (context.Exception is not Juple.Application.RequestCapacityExceededException) return;
        await RequestProtection.WriteRejectionAsync(context.HttpContext, TimeSpan.FromSeconds(2), context.HttpContext.RequestAborted);
        context.ExceptionHandled = true;
    }
}
