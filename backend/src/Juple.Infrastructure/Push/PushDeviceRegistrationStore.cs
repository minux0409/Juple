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
        CancellationToken cancellationToken = default)
    {
        var existing = await FindByInstallationAsync(platform, installationId, cancellationToken);

        if (existing is null)
        {
            var created = new PushDeviceRegistration(userId, platform, installationId, pushToken, locale, nowUtc, nowUtc);
            dbContext.PushDeviceRegistrations.Add(created);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
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
            existing.Reregister(pushToken, locale, nowUtc);
        }
        else
        {
            // Same installation, different user - an account switch on this device (see
            // PushDeviceRegistration.ReassignOwner's own remarks). This is a benign last-write-wins
            // race if two different users register the same installation nearly simultaneously: the
            // row still only ever has one UserId at a time, so it is never "active for two users" -
            // which one wins is undefined, but never both.
            existing.ReassignOwner(userId, pushToken, locale, nowUtc);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return ToDto(existing);
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
