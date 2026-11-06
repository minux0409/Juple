namespace Juple.Domain.Collections;

/// <summary>Historical association between a merge and the specific CollectionItem row it created.</summary>
public sealed class CollectionMergeCreatedMembership
{
    private CollectionMergeCreatedMembership()
    {
    }

    public long Id { get; private set; }

    public long MergeOperationId { get; private set; }

    public long CollectionItemId { get; private set; }
}
