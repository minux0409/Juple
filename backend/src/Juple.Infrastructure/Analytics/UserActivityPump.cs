using System.Collections.Concurrent;
using System.Threading.Channels;
using Juple.Application.Analytics;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Analytics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Analytics;

/// <summary>
/// Daily activity recording off the request path. A request only calls <see cref="Observe"/>: an in-memory check (has this
/// identity been recorded on this platform today, within the last hour?) and, at most then, a non-blocking hand-off to a bounded
/// channel. <see cref="RunAsync"/> resolves the internal UserId from the authenticated identity (never from anything the client
/// sends) and upserts the day's row. So each API instance writes at most once an hour per person and platform - not once per
/// request - and a slow or failing database never delays or fails the person's own request: a failed write is logged and simply
/// retried by a later request.
/// </summary>
public sealed class UserActivityPump(IServiceScopeFactory scopeFactory, TimeProvider timeProvider, ILogger<UserActivityPump> logger)
{
    /// <summary>How often the same person/platform may refresh LastSeenAtUtc from one instance.</summary>
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(1);

    /// <summary>The dedupe memory is cleared beyond this many entries (it then costs at most one extra write per person).</summary>
    public const int MaxRememberedEntries = 50_000;

    public const int Capacity = 2_048;

    private readonly Channel<UserActivitySignal> _channel = Channel.CreateBounded<UserActivitySignal>(
        new BoundedChannelOptions(Capacity) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

    private readonly ConcurrentDictionary<(Guid TenantId, Guid ObjectId, ClientPlatform Platform), (DateOnly Day, DateTimeOffset RecordedAt)> _recorded = new();

    private long _dropped;

    /// <summary>Called after an authenticated request. Returns whether a write was queued (false = already recorded recently, or full).</summary>
    public bool Observe(ExternalIdentityPrincipal identity, ClientPlatform platform, string? appBuild)
    {
        var now = timeProvider.GetUtcNow();
        var day = DateOnly.FromDateTime(now.UtcDateTime);
        var key = (identity.TenantId, identity.ObjectId, platform);
        if (_recorded.TryGetValue(key, out var last) && last.Day == day
            && Juple.Application.Admin.AdminDateRange.SeoulDate(last.RecordedAt) == Juple.Application.Admin.AdminDateRange.SeoulDate(now)
            && now - last.RecordedAt < RefreshInterval)
        {
            return false;
        }

        if (_recorded.Count >= MaxRememberedEntries)
        {
            _recorded.Clear();
        }

        _recorded[key] = (day, now);
        if (_channel.Writer.TryWrite(new UserActivitySignal(identity, platform, appBuild, day, now)))
        {
            return true;
        }

        _recorded.TryRemove(key, out _);
        if (Interlocked.Increment(ref _dropped) % 100 == 1)
        {
            logger.LogWarning("analytics.activity.dropped Dropped={Dropped} (queue full)", Interlocked.Read(ref _dropped));
        }

        return false;
    }

    public async Task RunAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var signal in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                await RecordAsync(signal, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down: what is still queued is only "today's activity" again on the next request.
        }
    }

    /// <summary>One signal (also the unit tests' entry point); never throws.</summary>
    public async Task RecordAsync(UserActivitySignal signal, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<ICurrentJupleUserAccessor>();
            CurrentJupleUser user;
            try
            {
                user = await users.GetRequiredAsync(signal.Identity, cancellationToken);
            }
            catch (CurrentJupleUserNotFoundException)
            {
                // No Juple account behind this sign-in (not created yet, or deleted): there is nobody to record.
                return;
            }

            await scope.ServiceProvider.GetRequiredService<IUserActivityStore>()
                .RecordAsync(user.UserId, signal.Day, signal.Platform, signal.AppBuild, signal.SeenAtUtc, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Forget it, so a later request of the same person records the day again. Only the exception type is logged.
            _recorded.TryRemove((signal.Identity.TenantId, signal.Identity.ObjectId, signal.Platform), out _);
            logger.LogWarning("analytics.activity.record_failed Platform={Platform} Error={ErrorType}", signal.Platform, exception.GetType().Name);
        }
    }

    public sealed record UserActivitySignal(ExternalIdentityPrincipal Identity, ClientPlatform Platform, string? AppBuild, DateOnly Day, DateTimeOffset SeenAtUtc);
}
