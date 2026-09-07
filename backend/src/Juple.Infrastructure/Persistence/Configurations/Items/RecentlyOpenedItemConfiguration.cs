using Juple.Domain.Items;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Items;

public sealed class RecentlyOpenedItemConfiguration : IEntityTypeConfiguration<RecentlyOpenedItem>
{
    public void Configure(EntityTypeBuilder<RecentlyOpenedItem> builder)
    {
        builder.ToTable("RecentlyOpenedItems", "items");

        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(entry => entry.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(entry => entry.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(entry => entry.LastOpenedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // My Page's "최근 본 링크" list query pattern (LastOpenedAtUtc DESC, ItemId DESC, cursor-paged).
        builder.HasIndex(entry => new { entry.UserId, entry.LastOpenedAtUtc, entry.ItemId })
            .HasDatabaseName("IX_RecentlyOpenedItems_UserId_LastOpenedAtUtc_ItemId");

        // At most one row per (UserId, ItemId) - re-opening an Item must update this row's
        // LastOpenedAtUtc in place, never add another row. Enforced by the database, not just by
        // RecentlyOpenedItemStore.RecordOpenAsync's own pre-check (mirrors
        // UX_CollectionItems_CollectionId_ItemId's same role for CollectionItem).
        builder.HasIndex(entry => new { entry.UserId, entry.ItemId })
            .IsUnique()
            .HasDatabaseName("UX_RecentlyOpenedItems_UserId_ItemId");

        // A membership row is meaningless without its Item - deleting the Item must remove this
        // user's "recently opened" record for it too (mirrors CollectionItem's Cascade-on-Item).
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(entry => entry.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Mirrors ItemConfiguration's own FK to User (NoAction) - account deletion
        // (AccountDeletionStore) explicitly clears this table by UserId rather than relying on a
        // cascade from User.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(entry => entry.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
