namespace Juple.Application.Collections.Locking;

/// <summary>
/// Who an unlock grant is bound to: an authenticated user ('u', UserId) for in-app access, or one
/// public share link ('p', CollectionShare.Id) for anonymous web access. A grant for one subject is
/// never valid for another, and ThrottleKey scopes the failed-attempt counter the same way.
/// </summary>
public sealed record CollectionUnlockSubject(char Kind, long Id)
{
    public static CollectionUnlockSubject ForUser(long userId) => new('u', userId);

    public static CollectionUnlockSubject ForPublicShare(long shareId) => new('p', shareId);

    public string ThrottleKey => $"{Kind}:{Id}";
}
