using Juple.Domain.Categories;
using Juple.Domain.Identity;
using Juple.Domain.Images;
using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence;

public sealed class JupleDbContext(DbContextOptions<JupleDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<ExternalIdentity> ExternalIdentities => Set<ExternalIdentity>();

    public DbSet<Item> Items => Set<Item>();

    public DbSet<ItemSaveRequest> ItemSaveRequests => Set<ItemSaveRequest>();

    public DbSet<Category> Categories => Set<Category>();

    public DbSet<ItemImage> ItemImages => Set<ItemImage>();

    public DbSet<Purchase> Purchases => Set<Purchase>();

    public DbSet<RepeatPurchase> RepeatPurchases => Set<RepeatPurchase>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(JupleDbContext).Assembly);
    }
}
