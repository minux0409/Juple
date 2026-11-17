using Juple.Domain.Billing;

namespace Juple.Application.Billing;

public interface IMembershipGrantReader
{
    Task<bool> HasPreviewAsync(long userId, CancellationToken cancellationToken);
    Task<ComplimentaryAccess> GetComplimentaryAsync(long userId, DateTimeOffset now, CancellationToken cancellationToken);
}
