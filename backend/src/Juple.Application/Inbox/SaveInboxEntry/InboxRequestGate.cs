namespace Juple.Application.Inbox.SaveInboxEntry;

/// <summary>
/// Bounded, per-replica request-ID serialization. SQL's unique save ledger remains authoritative
/// across replicas. No SQL transaction or lock is held over outbound HTTP.
/// </summary>
internal static class InboxRequestGate
{
    private static readonly Dictionary<(long, Guid), Entry> Entries = [];
    private sealed class Entry
    {
        public readonly SemaphoreSlim Semaphore = new(1, 1);
        public int Users;
    }

    public static async Task<IDisposable?> EnterAsync(long userId, Guid? requestId, CancellationToken cancellationToken)
    {
        if (requestId is null) return null;
        var key = (userId, requestId.Value);
        Entry entry;
        lock (Entries)
        {
            if (!Entries.TryGetValue(key, out entry!))
            {
                if (Entries.Count >= 64) throw new RequestCapacityExceededException();
                Entries.Add(key, entry = new Entry());
            }
            if (entry.Users >= 4) throw new RequestCapacityExceededException();
            entry.Users++;
        }
        try { await entry.Semaphore.WaitAsync(cancellationToken); }
        catch { Leave(key, entry, acquired: false); throw; }
        return new Lease(() => Leave(key, entry, acquired: true));
    }

    private static void Leave((long, Guid) key, Entry entry, bool acquired)
    {
        lock (Entries)
        {
            if (acquired) entry.Semaphore.Release();
            if (--entry.Users == 0)
            {
                Entries.Remove(key);
                entry.Semaphore.Dispose();
            }
        }
    }

    private sealed class Lease(Action release) : IDisposable
    {
        private Action? held = release;
        public void Dispose() => Interlocked.Exchange(ref held, null)?.Invoke();
    }
}
