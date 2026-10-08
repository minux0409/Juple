using Juple.Application.Notifications.Inbox;
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
            table.HasCheckConstraint("CK_Notifications_Type_Valid", "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
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

        // Social notifications (Types 1-5) - plain ids, deliberately no FKs: a row must never block
        // deleting the actor, the Collection or the invitation/request it mentions (account
        // deletion removes rows by UserId and ActorUserId - see AccountDeletionStore), and the
        // dispatcher re-checks that the subject still exists/is still pending before sending.
        builder.Property(notification => notification.ActorUserId)
            .HasColumnType("bigint");

        builder.Property(notification => notification.CollectionId)
            .HasColumnType("bigint");

        builder.Property(notification => notification.SubjectId)
            .HasColumnType("bigint");

        builder.Property(notification => notification.ItemCount)
            .HasColumnType("int");

        builder.Property(notification => notification.DedupKey)
            .HasColumnType("varchar(120)")
            .HasMaxLength(120)
            .IsUnicode(false);

        builder.Property(notification => notification.DispatchedAtUtc)
            .HasColumnType("datetimeoffset");

        // Newest-first inbox listing - the primary Notification query pattern.
        builder.HasIndex(notification => new { notification.UserId, notification.CreatedAtUtc, notification.Id })
            .HasDatabaseName("IX_Notifications_UserId_CreatedAtUtc_Id");

        // The Notification Inbox (see NotificationInboxStore): the recipient's visible rows newest first,
        // keyset by Id. Filtered to the Inbox Types so the data-only refresh rows (which are never shown
        // and never read) are not even in it. The queries write the same Type set as SQL literals.
        builder.HasIndex(notification => new { notification.UserId, notification.Id })
            .HasFilter(NotificationInboxPolicy.InboxTypesSql)
            .HasDatabaseName("IX_Notifications_Inbox");

        // Unread Inbox rows only - small by nature (rows leave it when read): the bell's total, a
        // Collection card's unread 새 링크 count (UserId, Type, CollectionId) and the set-based read updates.
        // ReadAtUtc is included although the filter already fixes it: SQL Server only treats a query's
        // "ReadAtUtc IS NULL" as covered when the filtered column is in the index (without it, the
        // bell's count was planned as a clustered scan).
        builder.HasIndex(notification => new { notification.UserId, notification.Type, notification.CollectionId })
            .IncludeProperties(notification => notification.ReadAtUtc)
            .HasFilter("[ReadAtUtc] IS NULL AND " + NotificationInboxPolicy.InboxTypesSql)
            .HasDatabaseName("IX_Notifications_Unread");

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

        // The same social event enqueues at most once (see SocialNotificationPublisher).
        builder.HasIndex(notification => notification.DedupKey)
            .IsUnique()
            .HasFilter("[DedupKey] IS NOT NULL")
            .HasDatabaseName("UX_Notifications_DedupKey");

        // The Push dispatcher's only query: not yet dispatched, oldest first.
        builder.HasIndex(notification => new { notification.CreatedAtUtc, notification.Id })
            .HasFilter("[DispatchedAtUtc] IS NULL AND [DedupKey] IS NOT NULL")
            .HasDatabaseName("IX_Notifications_PendingDispatch");

        // Account deletion of the actor removes the notifications they caused for other people.
        builder.HasIndex(notification => notification.ActorUserId)
            .HasFilter("[ActorUserId] IS NOT NULL")
            .HasDatabaseName("IX_Notifications_ActorUserId");

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
