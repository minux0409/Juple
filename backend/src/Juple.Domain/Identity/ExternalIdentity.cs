namespace Juple.Domain.Identity;

public sealed class ExternalIdentity
{
    private ExternalIdentity()
    {
    }

    public ExternalIdentity(
        long userId,
        Guid tenantId,
        Guid objectId,
        DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        TenantId = tenantId;
        ObjectId = objectId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid ObjectId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
