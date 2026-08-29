namespace Juple.Application.Identity;

public sealed record ExternalIdentityPrincipal(Guid TenantId, Guid ObjectId);