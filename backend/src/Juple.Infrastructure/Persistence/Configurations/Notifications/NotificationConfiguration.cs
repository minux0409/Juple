using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Notifications;

public sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("Notifications", "notifications", table =>
        {
            // Same DB-level guard as RepeatPurchaseConfiguration's CK_RepeatPurchases_IntervalUnit_Valid
            // for its own byte enum - blocks any value outside the currently-defined Type range.
            table.HasCheckConstraint("CK_Notifications_Type_Valid", "[Type] IN (0)");
        });

        builder.HasKey(notification => notification.Id);
        builder.Property(notification => notification.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(notification => notification.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(notification => notification.Type)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(notification => notification.RepeatPurchaseId)
            .HasColumnType("bigint");

        builder.Property(notification => notification.ItemId)
            .HasColumnType("bigint");

        builder.Property(notification => notification.ProductNameSnapshot)
            .HasColumnType("nvarchar(500)")
            .HasMaxLength(500);

        builder.Property(notification => notification.DueDate)
            .HasColumnType("date");

        builder.Property(notification => notification.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(notification => notification.ReadAtUtc)
            .HasColumnType("datetimeoffset");

        // Newest-first inbox listing - the primary Notification query pattern.
        builder.HasIndex(notification => new { notification.UserId, notification.CreatedAtUtc, notification.Id })
            .HasDatabaseName("IX_Notifications_UserId_CreatedAtUtc_Id");

        // Unread-count query pattern (WHERE UserId = @u AND ReadAtUtc IS NULL).
        builder.HasIndex(notification => new { notification.UserId, notification.ReadAtUtc })
            .HasDatabaseName("IX_Notifications_UserId_ReadAtUtc");

        // EF already creates these by convention for the ItemId/RepeatPurchaseId FKs below (the
        // unique index further down has RepeatPurchaseId as a non-leading column, so it does not
        // itself cover a plain "by RepeatPurchaseId" lookup); declared explicitly only to name/
        // document them the same way every other optional cross-module FK in this codebase does
        // (mirrors IX_RepeatPurchases_ItemId/IX_Purchases_ItemId) - no schema change from omitting them.
        builder.HasIndex(notification => notification.ItemId)
            .HasDatabaseName("IX_Notifications_ItemId");

        builder.HasIndex(notification => notification.RepeatPurchaseId)
            .HasDatabaseName("IX_Notifications_RepeatPurchaseId");

        // Race-safe duplicate prevention for the same due cycle - see NotificationStore.
        // MaterializeDueAsync. Type is included (even though only RepeatPurchaseDue exists today)
        // so a future notification Type that also happens to carry a RepeatPurchaseId/DueDate never
        // collides with this one on the same values - this index's uniqueness is scoped per Type,
        // not shared across every future Type. Filtered so a Type without a RepeatPurchaseId/DueDate
        // never collides at all (SQL Server already treats NULLs as distinct in a unique index, but
        // the filter keeps the intent explicit).
        builder.HasIndex(notification => new { notification.Type, notification.RepeatPurchaseId, notification.DueDate })
            .IsUnique()
            .HasFilter("[RepeatPurchaseId] IS NOT NULL AND [DueDate] IS NOT NULL")
            .HasDatabaseName("UX_Notifications_Type_RepeatPurchaseId_DueDate");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(notification => notification.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        // A due-notification's history is meaningless without the RepeatPurchase it is about -
        // deleting the RepeatPurchase deletes its own notification history too, rather than leaving
        // an orphaned unread row nothing can ever resolve (see RepeatPurchaseStore.DeleteAsync and
        // this feature's simplest-safe-policy design notes).
        builder.HasOne<RepeatPurchase>()
            .WithMany()
            .HasForeignKey(notification => notification.RepeatPurchaseId)
            .OnDelete(DeleteBehavior.Cascade);

        // Only used to deep-link Mobile to ItemDetails - deleting the Item must never delete
        // notification history, only detach the reference, mirroring Purchase/RepeatPurchase's own
        // ItemId handling.
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(notification => notification.ItemId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
