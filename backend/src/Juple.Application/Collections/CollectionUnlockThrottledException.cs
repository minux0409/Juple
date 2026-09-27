namespace Juple.Application.Collections;

/// <summary>Too many failed unlock attempts for this Collection and subject - refused before any password check (429).</summary>
public sealed class CollectionUnlockThrottledException(DateTimeOffset retryAfterUtc) : Exception
{
    public DateTimeOffset RetryAfterUtc { get; } = retryAfterUtc;
}
