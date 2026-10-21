using Juple.Application.Push;
using Juple.Domain.Push;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Push;

public sealed class PushDeviceRegistrationStore(JupleDbContext dbContext) : IPushDeviceRegistrationStore
{
    public async Task<PushDeviceRegistrationDto> RegisterAsync(
        long userId,
        PushPlatform platform,
        string installationId,
        string pushToken,
        string locale,
        DateTimeOffset nowUtc,
        ApnsEnvironment? apnsEnvironment = null,
        CancellationToken cancellationToken = default)
    {
        if (dbContext.Database.CurrentTransaction is not null)
        {
            await LockAsync(platform, installationId, pushToken, cancellationToken);
            return await RegisterLockedAsync(userId, platform, installationId, pushToken, locale, nowUtc, apnsEnvironment, cancellationToken);
        }

        // One transaction per registration, holding two exclusive app locks until it commits, always in the same order (the
        // installation, then the token) so registrations can never deadlock each other:
        // - the installation lock: simultaneous registrations of ONE installation (a double launch, an account switch) run one after the
        //   other - one row, one owner (the unique index stays the backstop);
        // - the token lock: simultaneous registrations of the SAME token under different installation ids run one after the other, so
        //   the later one disables the earlier and exactly one registration stays enabled - never both (another account's Push on this
        //   phone) and never neither (each disabling the other).
        // A deadlock with some other workload is retried a couple of times (the whole registration is idempotent).
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                await LockAsync(platform, installationId, pushToken, cancellationToken);
                var registered = await RegisterLockedAsync(userId, platform, installationId, pushToken, locale, nowUtc, apnsEnvironment, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return registered;
            }
            catch (Exception exception) when (attempt < MaxDeadlockAttempts && IsDeadlock(exception))
            {
                dbContext.ChangeTracker.Clear();
            }
        }
    }

    private const int MaxDeadlockAttempts = 3;

    private static bool IsDeadlock(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is Microsoft.Data.SqlClient.SqlException { Number: 1205 })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// sp_getapplock (released with the transaction) on the installation, then on the token. The resources name both only by hash - the
    /// token never appears in a lock name, and a client-supplied installation id can never exceed the 255-character resource limit.
    /// </summary>
    private async Task LockAsync(PushPlatform platform, string installationId, string pushToken, CancellationToken cancellationToken)
    {
        await LockResourceAsync($"push-installation:{(byte)platform}:{Convert.ToHexStringLower(PushTokenHash.Of(installationId))}", cancellationToken);
        await LockResourceAsync($"push-token:{(byte)platform}:{Convert.ToHexStringLower(PushTokenHash.Of(pushToken))}", cancellationToken);
    }

    private async Task LockResourceAsync(string resource, CancellationToken cancellationToken)
    {
        // Not composed (no LINQ operator on the query): a DECLARE/EXEC batch cannot be wrapped in a sub-select.
        var result = (await dbContext.Database
            .SqlQuery<int>($"DECLARE @result int; EXEC @result = sp_getapplock @Resource = {resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000; SELECT @result AS [Value]")
            .ToListAsync(cancellationToken)).Single();
        if (result < 0)
        {
            throw new TimeoutException("Timed out waiting for another registration of the same device or push token.");
        }
    }

    private async Task<PushDeviceRegistrationDto> RegisterLockedAsync(
        long userId,
        PushPlatform platform,
        string installationId,
        string pushToken,
        string locale,
        DateTimeOffset nowUtc,
        ApnsEnvironment? apnsEnvironment,
        CancellationToken cancellationToken)
    {
        var existing = await FindByInstallationAsync(platform, installationId, cancellationToken);

        if (existing is null)
        {
            var created = new PushDeviceRegistration(userId, platform, installationId, pushToken, locale, nowUtc, nowUtc, apnsEnvironment);
            dbContext.PushDeviceRegistrations.Add(created);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                await DisableOtherHoldersOfTokenAsync(created, nowUtc, cancellationToken);
                return ToDto(created);
            }
            catch (DbUpdateException exception) when (
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent registration call for this exact (Platform, InstallationId) won the
                // race (see UX_PushDeviceRegistrations_Platform_InstallationId) - reload and fall
                // through to the reassign/reregister path below instead of failing this call.
                dbContext.ChangeTracker.Clear();
                existing = await FindByInstallationAsync(platform, installationId, cancellationToken)
                    ?? throw new InvalidOperationException(
                        "Expected a PushDeviceRegistration to exist immediately after losing a unique constraint race for it.");
            }
        }

        if (existing.UserId == userId)
        {
            existing.Reregister(pushToken, locale, nowUtc, apnsEnvironment);
        }
        else
        {
            // Same installation, different user - an account switch on this device (see
            // PushDeviceRegistration.ReassignOwner's own remarks). This is a benign last-write-wins
            // race if two different users register the same installation nearly simultaneously: the
            // row still only ever has one UserId at a time, so it is never "active for two users" -
            // which one wins is undefined, but never both.
            existing.ReassignOwner(userId, pushToken, locale, nowUtc, apnsEnvironment);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await DisableOtherHoldersOfTokenAsync(existing, nowUtc, cancellationToken);
        return ToDto(existing);
    }

    /// <summary>
    /// A token addresses one phone (one app install): if any OTHER enabled registration of the same platform holds it - the app's
    /// installation id was regenerated, or a previous account's row on this phone was never disabled - that row is disabled, so the phone
    /// is never sent another account's Push. One indexed UPDATE (the hash column); idempotent; the row just registered is untouched.
    /// </summary>
    private async Task DisableOtherHoldersOfTokenAsync(PushDeviceRegistration current, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var hash = PushTokenHash.Of(current.PushToken);
        var token = current.PushToken;
        await dbContext.PushDeviceRegistrations
            .Where(registration => registration.Platform == current.Platform
                && registration.IsEnabled
                && registration.Id != current.Id
                && registration.PushTokenHash == hash
                && registration.PushToken == token)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(registration => registration.IsEnabled, false)
                    .SetProperty(registration => registration.UpdatedAtUtc, nowUtc),
                cancellationToken);

        // The bulk UPDATE bypasses the change tracker: forget any tracked copy of a row it just disabled, so a later re-registration of
        // that row in this same context reads its real (disabled) state instead of a stale "enabled" one and actually re-enables it.
        foreach (var stale in dbContext.ChangeTracker.Entries<PushDeviceRegistration>()
                     .Where(entry => entry.Entity.Id != current.Id
                         && entry.Entity.Platform == current.Platform
                         && string.Equals(entry.Entity.PushToken, token, StringComparison.Ordinal))
                     .ToList())
        {
            stale.State = EntityState.Detached;
        }
    }

    private Task<PushDeviceRegistration?> FindByInstallationAsync(
        PushPlatform platform, string installationId, CancellationToken cancellationToken) =>
        dbContext.PushDeviceRegistrations.FirstOrDefaultAsync(
            registration => registration.Platform == platform && registration.InstallationId == installationId,
            cancellationToken);

    public async Task DisableAsync(
        long userId, string installationId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
    {
        var registration = await dbContext.PushDeviceRegistrations
            .FirstOrDefaultAsync(
                registration => registration.UserId == userId && registration.InstallationId == installationId,
                cancellationToken);
        if (registration is null)
        {
            throw new PushDeviceRegistrationNotFoundException();
        }

        registration.Disable(updatedAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task DisableByIdAsync(
        long id, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
    {
        var registration = await dbContext.PushDeviceRegistrations
            .FirstOrDefaultAsync(registration => registration.Id == id, cancellationToken);
        if (registration is null)
        {
            return;
        }

        registration.Disable(updatedAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(
        long userId, CancellationToken cancellationToken = default) =>
        await dbContext.PushDeviceRegistrations
            .Where(registration => registration.UserId == userId && registration.IsEnabled)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledForUsersAsync(
        IReadOnlyCollection<long> userIds, CancellationToken cancellationToken = default)
    {
        var ids = userIds.Distinct().ToList();
        return ids.Count == 0
            ? []
            : await dbContext.PushDeviceRegistrations
                .AsNoTracking()
                .Where(registration => ids.Contains(registration.UserId) && registration.IsEnabled)
                .ToListAsync(cancellationToken);
    }

    private static PushDeviceRegistrationDto ToDto(PushDeviceRegistration registration) => new(
        registration.Id,
        registration.Platform,
        registration.InstallationId,
        registration.Locale,
        registration.IsEnabled,
        registration.CreatedAtUtc,
        registration.UpdatedAtUtc,
        registration.LastSeenAtUtc);
}
