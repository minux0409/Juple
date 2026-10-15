using Juple.Domain.Safety;

namespace Juple.Application.Safety;

// ---- Terms of Service consent -------------------------------------------------------------------------------------------------------

/// <summary>
/// The Terms of Service version that is in force (configuration <c>Terms:CurrentVersion</c>, default the version of the published Web terms).
/// A person must have agreed to exactly this version before creating user-generated content; publishing a new version simply asks again.
/// </summary>
public sealed class TermsOptions
{
    public const string DefaultVersion = "2026-10-14";

    public string CurrentVersion { get; set; } = DefaultVersion;

    /// <summary>
    /// On (default): a content write without the current acceptance is refused (403 termsAcceptanceRequired). Off exists ONLY for a rollout window
    /// in which installed apps that predate the acceptance screen must keep working (see docs/ugc-moderation.md) - it is never the steady state.
    /// </summary>
    public bool EnforceAcceptance { get; set; } = true;
}

/// <summary>What a client needs to know: which version is current, which one the person accepted (null = none) and whether that is enough.</summary>
public sealed record TermsStatusDto(string CurrentVersion, string? AcceptedVersion, DateTimeOffset? AcceptedAtUtc, bool IsAccepted);

/// <summary>403 <c>termsAcceptanceRequired</c> - a user-generated-content write before the current Terms were accepted.</summary>
public sealed class TermsAcceptanceRequiredException : Exception;

/// <summary>400 - the version sent is not the current one (an old screen, or a made-up value).</summary>
public sealed class InvalidTermsVersionException : Exception;

public interface ITermsConsentService
{
    Task<TermsStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Records the agreement to the CURRENT version (idempotent: the earlier time is kept when it was already accepted).</summary>
    Task<TermsStatusDto> AcceptAsync(long userId, string? version, CancellationToken cancellationToken = default);

    /// <summary>Throws <see cref="TermsAcceptanceRequiredException"/> unless the person accepted the current version.</summary>
    Task RequireAcceptedAsync(long userId, CancellationToken cancellationToken = default);
}

// ---- Reports -------------------------------------------------------------------------------------------------------------------------

/// <summary>The unvalidated request as the API received it. TargetId is a Juple ID for a user and a number for everything else.</summary>
public sealed record CreateReportCommand(string? TargetType, string? TargetId, long? CollectionId, string? Reason, string? Details);

/// <summary>The only thing a reporter learns back: it was received, and whether this was an already open report of theirs.</summary>
public sealed record ReportReceiptDto(bool AlreadyReported);

public sealed class InvalidReportException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

/// <summary>The target does not exist or the reporter may not see it - one and the same answer, so ids reveal nothing.</summary>
public sealed class ReportTargetNotFoundException : Exception;

/// <summary>400 <c>cannotReportOwnContent</c>.</summary>
public sealed class ReportOwnContentException : Exception;

public enum ReportTargetOutcome
{
    Found,
    NotFound,
    Own,
}

/// <summary>What the store resolved a report target to (internal ids only, never leaving the Application layer).</summary>
public sealed record ReportTargetResolution(ReportTargetOutcome Outcome, long TargetId = 0, long? TargetUserId = null, long? CollectionId = null)
{
    public static ReportTargetResolution NotFound { get; } = new(ReportTargetOutcome.NotFound);

    public static ReportTargetResolution Own { get; } = new(ReportTargetOutcome.Own);
}

public interface IReportService
{
    Task<ReportReceiptDto> CreateAsync(long reporterUserId, CreateReportCommand command, CancellationToken cancellationToken = default);
}

// ---- Blocking ------------------------------------------------------------------------------------------------------------------------

/// <summary>A person the caller blocked, as the caller sees them: public Juple ID, the chosen display name, the photo. Never an internal id.</summary>
public sealed record BlockedUserDto(string JupleId, string? DisplayName, DateTimeOffset BlockedAtUtc, string? ProfileImageUrl = null, string? ProfileImageVersion = null);

public sealed class InvalidBlockException(string message) : Exception(message);

/// <summary>
/// 403. <see cref="BlockedByCaller"/> is true when the CALLER blocked the other person (they know, and can unblock); false when the other
/// person blocked the caller - then the API answers exactly as if the person did not exist, so a block is never revealed to the blocked.
/// </summary>
public sealed class UserBlockedException(bool blockedByCaller) : Exception
{
    public bool BlockedByCaller { get; } = blockedByCaller;
}

public interface IUserBlockService
{
    /// <summary>Idempotent. Also ends a friendship / pending friend request between the two (a block is a stronger "no" than not being friends).</summary>
    Task BlockAsync(long blockerUserId, string? jupleId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent. Does not bring a friendship back - a new friend request is needed.</summary>
    Task UnblockAsync(long blockerUserId, string? jupleId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<BlockedUserDto>> ListAsync(long blockerUserId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The ONE question every interaction asks: "may these two people interact?" A block in either direction says no. Used by friend requests,
/// collaboration invitations / joins, comments, hearts and reactions, user lookup and notification delivery - never copied into controllers.
/// </summary>
public interface IUserBlockPolicy
{
    /// <summary>True when either person blocked the other.</summary>
    Task<bool> AreBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default);

    /// <summary>Throws <see cref="UserBlockedException"/> when either person blocked the other.</summary>
    Task EnsureNotBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default);

    /// <summary>The people <paramref name="viewerUserId"/> blocked - what their own views hide.</summary>
    Task<IReadOnlySet<long>> BlockedByAsync(long viewerUserId, CancellationToken cancellationToken = default);
}

// ---- Store ---------------------------------------------------------------------------------------------------------------------------

public interface ISafetyStore
{
    Task<(string? Version, DateTimeOffset? AcceptedAtUtc)> GetTermsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Stores the acceptance unless the SAME version is already recorded (then the first time stays). Returns the stored state.</summary>
    Task<(string Version, DateTimeOffset AcceptedAtUtc)> SetTermsAsync(long userId, string version, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Finds what a report names and checks the reporter may see it (see ReportService). collectionId is the context for an Item.</summary>
    Task<ReportTargetResolution> ResolveReportTargetAsync(long reporterUserId, ReportTargetType type, string targetId, long? collectionId, CancellationToken cancellationToken = default);

    /// <summary>Adds the report unless the reporter already has an OPEN one for the same target; AlreadyOpen then.</summary>
    Task<bool> TryCreateReportAsync(ContentReport report, CancellationToken cancellationToken = default);

    /// <summary>True when the block was created now (false: it already existed). Also deletes the friendship / pending request between the two.</summary>
    Task<bool> AddBlockAsync(long blockerUserId, long blockedUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>True when a block was removed.</summary>
    Task<bool> RemoveBlockAsync(long blockerUserId, long blockedUserId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<BlockedUserDto>> ListBlockedAsync(long blockerUserId, int limit, CancellationToken cancellationToken = default);

    /// <summary>(blockedByUser, blockedUser): whether userId blocked otherUserId, and whether otherUserId blocked userId.</summary>
    Task<(bool ByUser, bool ByOther)> GetBlockDirectionsAsync(long userId, long otherUserId, CancellationToken cancellationToken = default);

    Task<IReadOnlySet<long>> GetBlockedUserIdsAsync(long blockerUserId, CancellationToken cancellationToken = default);

}
