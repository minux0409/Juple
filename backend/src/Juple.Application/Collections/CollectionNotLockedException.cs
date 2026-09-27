namespace Juple.Application.Collections;

/// <summary>An unlock was requested for a Collection that is not locked (409 - nothing to unlock).</summary>
public sealed class CollectionNotLockedException : Exception
{
}
