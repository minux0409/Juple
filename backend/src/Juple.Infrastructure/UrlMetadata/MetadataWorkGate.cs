using Juple.Application;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>Shared across typed HttpClient instances, cache misses and background retry callers, per replica.</summary>
public sealed class MetadataWorkGate(int concurrency = 4) : IDisposable
{
    private readonly SemaphoreSlim semaphore = new(concurrency, concurrency);

    public IDisposable Enter()
    {
        if (!semaphore.Wait(0)) throw new RequestCapacityExceededException();
        return new Lease(semaphore);
    }

    public void Dispose() => semaphore.Dispose();
    private sealed class Lease(SemaphoreSlim semaphore) : IDisposable
    {
        private SemaphoreSlim? held = semaphore;
        public void Dispose() => Interlocked.Exchange(ref held, null)?.Release();
    }
}
