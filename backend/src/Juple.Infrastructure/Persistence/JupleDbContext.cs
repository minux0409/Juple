using Juple.Domain.Identity;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence;

public sealed class JupleDbContext(DbContextOptions<JupleDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<ExternalIdentity> ExternalIdentities => Set<ExternalIdentity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(JupleDbContext).Assembly);
    }
}
