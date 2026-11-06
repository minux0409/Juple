namespace Juple.Domain.Collections;

/// <summary>Historical Collection merge record retained for account deletion and retention cleanup.</summary>
public sealed class CollectionMergeOperation
{
    private CollectionMergeOperation()
    {
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid OperationToken { get; private set; }

    public long SourceCollectionId { get; private set; }

    public long TargetCollectionId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? UndoneAtUtc { get; private set; }
}
