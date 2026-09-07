using Juple.Domain.Collections;
using Juple.Domain.Identity;
using Juple.Domain.Images;
using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Purchases;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence;

public sealed class JupleDbContext(DbContextOptions<JupleDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<ExternalIdentity> ExternalIdentities => Set<ExternalIdentity>();

    public DbSet<Item> Items => Set<Item>();

    public DbSet<ItemSaveRequest> ItemSaveRequests => Set<ItemSaveRequest>();

    public DbSet<RecentlyOpenedItem> RecentlyOpenedItems => Set<RecentlyOpenedItem>();

    public DbSet<ItemImage> ItemImages => Set<ItemImage>();

    public DbSet<AccountDeletionBlobCleanup> AccountDeletionBlobCleanups => Set<AccountDeletionBlobCleanup>();

    public DbSet<Purchase> Purchases => Set<Purchase>();

    public DbSet<RepeatPurchase> RepeatPurchases => Set<RepeatPurchase>();

    public DbSet<Collection> Collections => Set<Collection>();

    public DbSet<CollectionItem> CollectionItems => Set<CollectionItem>();

    public DbSet<CollectionShare> CollectionShares => Set<CollectionShare>();

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<NotificationDelivery> NotificationDeliveries => Set<NotificationDelivery>();

    public DbSet<PushDeviceRegistration> PushDeviceRegistrations => Set<PushDeviceRegistration>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(JupleDbContext).Assembly);
    }
}
