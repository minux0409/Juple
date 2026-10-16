using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Users;

namespace Juple.UnitTests.Users;

/// <summary>Shared fakes for the Entra account-deletion tests.</summary>
internal static class EntraTestDoubles
{
    public static readonly Guid CustomerTenant = Guid.Parse("d2e79a05-cf5f-43ab-86d2-717e025a74b1");

    public static EntraAccountDeletionOptions EnabledOptions() => new()
    {
        Enabled = true,
        TenantId = CustomerTenant,
        ClientId = "app-client-id",
        ManagedIdentityClientId = "mi-client-id",
    };

    /// <summary>A real hasher over a throw-away key, so the email hash behaves exactly as in production.</summary>
    public static ITrialIdentityHasher Hasher() => new TrialIdentityHasher(new BillingOptions
    {
        TrialIdentityHashKey = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray()),
    });

    public static ITrialIdentityHasher HasherWithoutKey() => new TrialIdentityHasher(new BillingOptions());

    public sealed class FakeDirectory : IEntraIdentityDirectory
    {
        public string? Email { get; set; }

        public Exception? DeleteFailure { get; set; }

        public EntraIdentityDeletionOutcome Outcome { get; set; } = EntraIdentityDeletionOutcome.Deleted;

        public List<ExternalIdentityPrincipal> Deleted { get; } = [];

        public Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Email);

        public Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default)
        {
            if (DeleteFailure is not null)
            {
                throw DeleteFailure;
            }

            Deleted.Add(identity);
            return Task.FromResult(Outcome);
        }
    }

    public sealed class FakeDeletionService : IEntraIdentityDeletionService
    {
        public bool Pending { get; set; }

        public List<long> Completed { get; } = [];

        public Task<bool> TryCompleteAsync(long taskId, CancellationToken cancellationToken = default)
        {
            Completed.Add(taskId);
            return Task.FromResult(true);
        }

        public Task<EntraDeletionRunResult> RunPendingAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new EntraDeletionRunResult(0, 0, 0));

        public Task<bool> IsStillPendingAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Pending);
    }

    public sealed class FakeTrialEmailLedger : ITrialEmailLedger
    {
        public List<(ExternalIdentityPrincipal Identity, byte[] Hash)> Inherited { get; } = [];

        public Task InheritAsync(ExternalIdentityPrincipal identity, byte[] emailHash, CancellationToken cancellationToken = default)
        {
            Inherited.Add((identity, emailHash));
            return Task.CompletedTask;
        }
    }

    public sealed class FakeEntitlements : IEntitlementService
    {
        public List<long> SettledUsers { get; } = [];

        public bool Throw { get; set; }

        public Task<Juple.Domain.Billing.Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default)
        {
            if (Throw)
            {
                throw new InvalidOperationException("Simulated entitlement failure.");
            }

            SettledUsers.Add(userId);
            return Task.FromResult(Juple.Domain.Billing.Entitlement.NotLaunched(DateTimeOffset.UnixEpoch));
        }

        public Task<Juple.Domain.Billing.Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Juple.Domain.Billing.Entitlement.NotLaunched(DateTimeOffset.UnixEpoch));

        public Task<Juple.Domain.Billing.StoreSubscriptionOwnership> GetStoreSubscriptionForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Juple.Domain.Billing.StoreSubscriptionOwnership.None);
    }

    public sealed class FakeEntraStore : IEntraIdentityDeletionStore
    {
        public Dictionary<long, PendingEntraIdentityDeletion> Tasks { get; } = [];

        /// <summary>Adds a task under the id the database would have given it (the entity's Id has a private setter).</summary>
        public void Add(long id, PendingEntraIdentityDeletion task)
        {
            typeof(PendingEntraIdentityDeletion).GetProperty(nameof(PendingEntraIdentityDeletion.Id))!.SetValue(task, id);
            Tasks[id] = task;
        }

        public Task<PendingEntraIdentityDeletion?> FindAsync(long id, CancellationToken cancellationToken = default) =>
            Task.FromResult(Tasks.GetValueOrDefault(id));

        public Task<PendingEntraIdentityDeletion?> FindForIdentityAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
            Task.FromResult(Tasks.Values.FirstOrDefault(task => task.TenantId == identity.TenantId && task.ObjectId == identity.ObjectId));

        public Task<IReadOnlyList<long>> ListPendingIdsAsync(int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<long>>(Tasks.Keys.OrderBy(id => id).Take(limit).ToList());

        public Task CompleteAsync(long id, CancellationToken cancellationToken = default)
        {
            Tasks.Remove(id);
            return Task.CompletedTask;
        }

        public Task RecordFailureAsync(long id, string errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default)
        {
            Tasks[id].RecordFailedAttempt(errorCode, attemptedAtUtc);
            return Task.CompletedTask;
        }

        public Task<EntraIdentityDeletionStats> GetStatsAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            var tasks = Tasks.Values.ToList();
            var oldestSeconds = tasks.Count == 0
                ? (long?)null
                : Math.Max(0, (long)(nowUtc - tasks.Min(task => task.CreatedAtUtc)).TotalSeconds);
            return Task.FromResult(new EntraIdentityDeletionStats(
                tasks.Count,
                oldestSeconds,
                tasks.Count(task => task.AttemptCount > 0),
                tasks.Count(task => task.AttemptCount > 1)));
        }
    }
}
