namespace Juple.Application.Collections.Collaboration;

public interface IUserDirectoryStore
{
    /// <summary>Exact match on an already-canonical Juple ID; internal UserId stays server-side.</summary>
    Task<long?> FindUserIdByPublicCodeAsync(string publicCode, CancellationToken cancellationToken = default);

    Task<string?> GetPublicCodeAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>The user's own chosen display name, or null when they have not set one.</summary>
    Task<string?> GetDisplayNameAsync(long userId, CancellationToken cancellationToken = default) =>
        Task.FromResult<string?>(null);
}
