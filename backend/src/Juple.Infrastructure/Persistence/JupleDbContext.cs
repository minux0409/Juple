using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence;

public sealed class JupleDbContext(DbContextOptions<JupleDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(JupleDbContext).Assembly);
    }
}
