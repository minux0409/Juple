using Juple.Application.Support;
using Juple.Domain.Support;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Support;

public sealed class SupportInquiryStore(JupleDbContext dbContext) : ISupportInquiryStore
{
    public async Task<(SupportInquiry Inquiry, bool Created)> CreateAsync(
        SupportInquiry inquiry,
        CancellationToken cancellationToken = default)
    {
        // A fast path only: two concurrent retries can both pass this check, so the real guarantee is
        // UX_SupportInquiries_UserId_ClientRequestId - the insert that loses the race returns the winner's row.
        var existing = await FindByRequestAsync(inquiry.UserId, inquiry.ClientRequestId, cancellationToken);
        if (existing is not null)
        {
            return (existing, false);
        }

        dbContext.SupportInquiries.Add(inquiry);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return (inquiry, true);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            var winner = await FindByRequestAsync(inquiry.UserId, inquiry.ClientRequestId, cancellationToken);
            if (winner is null)
            {
                throw;
            }

            return (winner, false);
        }
    }

    public async Task<IReadOnlyList<SupportInquiry>> ListAsync(
        long userId,
        long? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.SupportInquiries.AsNoTracking().Where(inquiry => inquiry.UserId == userId);
        if (cursor is { } after)
        {
            query = query.Where(inquiry => inquiry.Id < after);
        }

        return await query
            .OrderByDescending(inquiry => inquiry.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
    }

    public Task<SupportInquiry?> FindAsync(long userId, long inquiryId, CancellationToken cancellationToken = default) =>
        dbContext.SupportInquiries
            .AsNoTracking()
            .FirstOrDefaultAsync(inquiry => inquiry.Id == inquiryId && inquiry.UserId == userId, cancellationToken);

    public async Task<bool> AnswerAsync(
        long inquiryId,
        string answer,
        DateTimeOffset answeredAtUtc,
        CancellationToken cancellationToken = default)
    {
        var inquiry = await dbContext.SupportInquiries.FirstOrDefaultAsync(entry => entry.Id == inquiryId, cancellationToken);
        if (inquiry is null)
        {
            return false;
        }

        inquiry.RecordAnswer(answer, answeredAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private Task<SupportInquiry?> FindByRequestAsync(long userId, Guid clientRequestId, CancellationToken cancellationToken) =>
        dbContext.SupportInquiries
            .AsNoTracking()
            .FirstOrDefaultAsync(inquiry => inquiry.UserId == userId && inquiry.ClientRequestId == clientRequestId, cancellationToken);
}
