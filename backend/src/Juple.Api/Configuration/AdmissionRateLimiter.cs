using System.Threading.RateLimiting;

namespace Juple.Api.Configuration;

/// <summary>Attach only a fixed server-defined rejection label; never a URL, token or identity.</summary>
internal sealed class AdmissionRateLimiter(RateLimiter inner, string policy) : RateLimiter
{
    public const string PolicyMetadata = "juple-admission-policy";
    public override TimeSpan? IdleDuration => inner.IdleDuration;
    public override RateLimiterStatistics? GetStatistics() => inner.GetStatistics();
    protected override RateLimitLease AttemptAcquireCore(int permitCount) => Tag(inner.AttemptAcquire(permitCount));
    protected override async ValueTask<RateLimitLease> AcquireAsyncCore(int permitCount, CancellationToken cancellationToken)
        => Tag(await inner.AcquireAsync(permitCount, cancellationToken));
    private RateLimitLease Tag(RateLimitLease lease) => lease.IsAcquired ? lease : new RejectedLease(lease, policy);
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); }
    protected override ValueTask DisposeAsyncCore() => inner.DisposeAsync();

    private sealed class RejectedLease(RateLimitLease inner, string policy) : RateLimitLease
    {
        public override bool IsAcquired => false;
        public override IEnumerable<string> MetadataNames => inner.MetadataNames.Append(PolicyMetadata);
        public override bool TryGetMetadata(string metadataName, out object? metadata)
        {
            if (metadataName == PolicyMetadata) { metadata = policy; return true; }
            return inner.TryGetMetadata(metadataName, out metadata);
        }
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); }
    }
}
