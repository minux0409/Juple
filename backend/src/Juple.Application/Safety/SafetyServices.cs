using Juple.Application.Collections.Collaboration;
using Juple.Domain.Safety;
using Juple.Domain.Users;

namespace Juple.Application.Safety;

public sealed class TermsConsentService(ISafetyStore store, TermsOptions options, TimeProvider timeProvider) : ITermsConsentService
{
    public async Task<TermsStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default)
    {
        var (version, acceptedAt) = await store.GetTermsAsync(userId, cancellationToken);
        return new TermsStatusDto(options.CurrentVersion, version, acceptedAt, IsCurrent(version));
    }

    public async Task<TermsStatusDto> AcceptAsync(long userId, string? version, CancellationToken cancellationToken = default)
    {
        // Exactly the current version: an old screen or an invented value never records an agreement to something else.
        if (!string.Equals(version?.Trim(), options.CurrentVersion, StringComparison.Ordinal))
        {
            throw new InvalidTermsVersionException();
        }

        var (stored, at) = await store.SetTermsAsync(userId, options.CurrentVersion, timeProvider.GetUtcNow(), cancellationToken);
        return new TermsStatusDto(options.CurrentVersion, stored, at, true);
    }

    public async Task RequireAcceptedAsync(long userId, CancellationToken cancellationToken = default)
    {
        if (!options.EnforceAcceptance)
        {
            return;
        }

        var (version, _) = await store.GetTermsAsync(userId, cancellationToken);
        if (!IsCurrent(version))
        {
            throw new TermsAcceptanceRequiredException();
        }
    }

    private bool IsCurrent(string? version) => string.Equals(version, options.CurrentVersion, StringComparison.Ordinal);
}

public sealed class ReportService(ISafetyStore store, TimeProvider timeProvider) : IReportService
{
    public async Task<ReportReceiptDto> CreateAsync(long reporterUserId, CreateReportCommand command, CancellationToken cancellationToken = default)
    {
        // Exact stable codes only - a number or a differently cased name is not a valid code.
        if (!TryParse<ReportTargetType>(command.TargetType, out var targetType))
        {
            throw new InvalidReportException("targetType", "targetType must be one of the supported targets.");
        }

        if (!TryParse<ReportReason>(command.Reason, out var reason))
        {
            throw new InvalidReportException("reason", "reason must be one of the supported reasons.");
        }

        var targetId = command.TargetId?.Trim();
        if (string.IsNullOrEmpty(targetId) || targetId.Length > 64)
        {
            throw new InvalidReportException("targetId", "targetId is required.");
        }

        if (targetType != ReportTargetType.User
            && !(long.TryParse(targetId, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var number) && number > 0))
        {
            throw new InvalidReportException("targetId", "targetId is invalid.");
        }

        if (command.CollectionId is <= 0)
        {
            throw new InvalidReportException("collectionId", "collectionId is invalid.");
        }

        var details = NormalizeDetails(command.Details);

        var resolution = await store.ResolveReportTargetAsync(reporterUserId, targetType, targetId, command.CollectionId, cancellationToken);
        switch (resolution.Outcome)
        {
            case ReportTargetOutcome.NotFound:
                throw new ReportTargetNotFoundException();
            case ReportTargetOutcome.Own:
                throw new ReportOwnContentException();
        }

        var report = new ContentReport(
            reporterUserId, targetType, resolution.TargetId, resolution.TargetUserId, resolution.CollectionId, reason, details, timeProvider.GetUtcNow());
        var created = await store.TryCreateReportAsync(report, cancellationToken);
        return new ReportReceiptDto(AlreadyReported: !created);
    }

    private static string? NormalizeDetails(string? details)
    {
        var trimmed = details?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > ContentReport.DetailsMaxLength)
        {
            throw new InvalidReportException("details", $"details must be at most {ContentReport.DetailsMaxLength} characters.");
        }

        // Plain text: line breaks are fine, other control characters are not.
        if (trimmed.Any(character => char.IsControl(character) && character is not ('\n' or '\r' or '\t')))
        {
            throw new InvalidReportException("details", "details cannot contain control characters.");
        }

        return trimmed;
    }

    private static bool TryParse<TEnum>(string? value, out TEnum result) where TEnum : struct, Enum
    {
        result = default;
        return value is not null
            && Enum.GetNames<TEnum>().Contains(value, StringComparer.Ordinal)
            && Enum.TryParse(value, ignoreCase: false, out result);
    }
}

public sealed class UserBlockService(IUserDirectoryStore userDirectory, ISafetyStore store, TimeProvider timeProvider) : IUserBlockService
{
    public const int MaxListed = 500;

    public async Task BlockAsync(long blockerUserId, string? jupleId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(blockerUserId, jupleId, cancellationToken);
        await store.AddBlockAsync(blockerUserId, target, timeProvider.GetUtcNow(), cancellationToken);
    }

    public async Task UnblockAsync(long blockerUserId, string? jupleId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(blockerUserId, jupleId, cancellationToken);
        await store.RemoveBlockAsync(blockerUserId, target, cancellationToken);
    }

    public async Task<IReadOnlyList<BlockedUserDto>> ListAsync(long blockerUserId, CancellationToken cancellationToken = default) =>
        await store.ListBlockedAsync(blockerUserId, MaxListed, cancellationToken);

    private async Task<long> ResolveAsync(long blockerUserId, string? jupleId, CancellationToken cancellationToken)
    {
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode)
            || await userDirectory.FindUserIdByPublicCodeAsync(publicCode, cancellationToken) is not { } targetUserId)
        {
            throw new JupleIdNotFoundException();
        }

        if (targetUserId == blockerUserId)
        {
            throw new InvalidBlockException("You cannot block yourself.");
        }

        return targetUserId;
    }
}

public sealed class UserBlockPolicy(ISafetyStore store) : IUserBlockPolicy
{
    public async Task<bool> AreBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default)
    {
        if (userId == otherUserId)
        {
            return false;
        }

        var (byUser, byOther) = await store.GetBlockDirectionsAsync(userId, otherUserId, cancellationToken);
        return byUser || byOther;
    }

    public async Task EnsureNotBlockedAsync(long userId, long otherUserId, CancellationToken cancellationToken = default)
    {
        if (userId == otherUserId)
        {
            return;
        }

        var (byUser, byOther) = await store.GetBlockDirectionsAsync(userId, otherUserId, cancellationToken);
        if (byUser || byOther)
        {
            throw new UserBlockedException(blockedByCaller: byUser);
        }
    }

    public Task<IReadOnlySet<long>> BlockedByAsync(long viewerUserId, CancellationToken cancellationToken = default) =>
        store.GetBlockedUserIdsAsync(viewerUserId, cancellationToken);
}
