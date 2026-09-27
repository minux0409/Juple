using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Collections;

/// <summary>
/// ProblemDetails with a stable machine-readable "code" extension, so clients branch on
/// collaboration/lock outcomes without parsing titles. Never includes passwords, tokens or ids.
/// </summary>
public static class CollectionProblems
{
    public const string Forbidden = "collectionForbidden";
    public const string Locked = "collectionLocked";
    public const string InvalidPassword = "invalidCollectionPassword";
    public const string UnlockThrottled = "collectionUnlockThrottled";
    public const string NotLocked = "collectionNotLocked";
    public const string LockPasswordNotConfiguredCode = "collectionLockPasswordNotConfigured";
    public const string LockUsesAccountPassword = "collectionLockUsesAccountPassword";
    public const string RecentAuthenticationRequiredCode = "recentAuthenticationRequired";
    public const string PublicShareReadOnly = "publicShareReadOnly";
    public const string PublicShareNotActive = "publicShareNotActive";

    public static ObjectResult Create(int statusCode, string title, string code)
    {
        var problem = new ProblemDetails { Status = statusCode, Title = title };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = statusCode };
    }

    public static ObjectResult CollectionForbidden() =>
        Create(StatusCodes.Status403Forbidden, "Your role in this Collection does not allow this.", Forbidden);

    public static ObjectResult CollectionLocked() =>
        Create(StatusCodes.Status403Forbidden, "This Collection is locked.", Locked);

    public static ObjectResult InvalidCollectionPassword() =>
        Create(StatusCodes.Status403Forbidden, "The password is incorrect.", InvalidPassword);

    /// <summary>The user has no lock password yet - set it in Settings > 컬렉션 잠금 first.</summary>
    public static ObjectResult LockPasswordNotConfigured() =>
        Create(StatusCodes.Status409Conflict, "Set a Collection lock password first.", LockPasswordNotConfiguredCode);

    /// <summary>The current sign-in is not recent enough (or carries no verifiable sign-in time).</summary>
    public static ObjectResult RecentAuthenticationRequired() =>
        Create(StatusCodes.Status403Forbidden, "Sign in again to continue.", RecentAuthenticationRequiredCode);

    public static ObjectResult CollectionNotLocked() =>
        Create(StatusCodes.Status409Conflict, "This Collection is not locked.", NotLocked);

    public static ObjectResult Conflict(string code) =>
        Create(StatusCodes.Status409Conflict, "The request conflicts with this Collection's sharing state.", code);

    public static ObjectResult TooManyUnlockAttempts(HttpResponse response, DateTimeOffset retryAfterUtc, DateTimeOffset nowUtc)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling((retryAfterUtc - nowUtc).TotalSeconds));
        response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Create(StatusCodes.Status429TooManyRequests, "Too many attempts. Try again later.", UnlockThrottled);
    }
}
