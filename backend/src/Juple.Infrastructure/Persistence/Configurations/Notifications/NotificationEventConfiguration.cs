using Juple.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Notifications;

public sealed class NotificationEventConfiguration : IEntityTypeConfiguration<NotificationEvent>
{
    public void Configure(EntityTypeBuilder<NotificationEvent> builder)
    {
        builder.ToTable("NotificationEvents", "notifications", table =>
        {
            // The same range as CK_Notifications_Type_Valid: an event always becomes Notifications of its Type.
            table.HasCheckConstraint("CK_NotificationEvents_Type_Valid", "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");
            table.HasCheckConstraint("CK_NotificationEvents_Status_Valid", "[Status] IN (0, 1, 2)");
        });

        builder.HasKey(notificationEvent => notificationEvent.Id);
        builder.Property(notificationEvent => notificationEvent.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(notificationEvent => notificationEvent.Type)
            .HasColumnType("tinyint")
            .IsRequired();

        // Plain ids, deliberately no FKs - the same reasoning as Notifications' social columns: an event
        // must never block deleting the actor, the recipient or the Collection (account deletion clears
        // a user's events itself - see AccountDeletionStore), and processing re-checks everything.
        builder.Property(notificationEvent => notificationEvent.ActorUserId).HasColumnType("bigint");
        builder.Property(notificationEvent => notificationEvent.RecipientUserId).HasColumnType("bigint");
        builder.Property(notificationEvent => notificationEvent.CollectionId).HasColumnType("bigint");
        builder.Property(notificationEvent => notificationEvent.SubjectId).HasColumnType("bigint");
        builder.Property(notificationEvent => notificationEvent.ItemCount).HasColumnType("int");
        builder.Property(notificationEvent => notificationEvent.HideActor).HasColumnType("bit").IsRequired();
        builder.Property(notificationEvent => notificationEvent.SkipUserId).HasColumnType("bigint");
        builder.Property(notificationEvent => notificationEvent.ItemId).HasColumnType("bigint");

        builder.Property(notificationEvent => notificationEvent.DedupKey)
            .HasColumnType("varchar(120)")
            .HasMaxLength(NotificationEvent.DedupKeyMaxLength)
            .IsUnicode(false);

        builder.Property(notificationEvent => notificationEvent.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(notificationEvent => notificationEvent.Status).HasColumnType("tinyint").IsRequired();
        builder.Property(notificationEvent => notificationEvent.CompletedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(notificationEvent => notificationEvent.LeaseUntilUtc).HasColumnType("datetimeoffset");
        builder.Property(notificationEvent => notificationEvent.NextAttemptAtUtc).HasColumnType("datetimeoffset");
        builder.Property(notificationEvent => notificationEvent.LastAttemptAtUtc).HasColumnType("datetimeoffset");
        builder.Property(notificationEvent => notificationEvent.AttemptCount).HasColumnType("int").IsRequired();
        builder.Property(notificationEvent => notificationEvent.RequiresAttention).HasColumnType("bit").IsRequired();
        builder.Property(notificationEvent => notificationEvent.RecipientCursor).HasColumnType("bigint");

        builder.Property(notificationEvent => notificationEvent.LastErrorCode)
            .HasColumnType("varchar(64)")
            .HasMaxLength(NotificationEvent.LastErrorCodeMaxLength)
            .IsUnicode(false);

        // Recording an event is idempotent per key (see NotificationEventKeys: a business object's id,
        // or a coalescing time bucket that never blocks a later window).
        builder.HasIndex(notificationEvent => notificationEvent.DedupKey)
            .IsUnique()
            .HasFilter("[DedupKey] IS NOT NULL")
            .HasDatabaseName("UX_NotificationEvents_DedupKey");

        // The recovery Job's scan: Pending only (normally few rows), oldest first, with the retry
        // schedule and lease included so not-yet-due rows are skipped inside the index.
        builder.HasIndex(notificationEvent => new { notificationEvent.CreatedAtUtc, notificationEvent.Id })
            .IncludeProperties(notificationEvent => new { notificationEvent.NextAttemptAtUtc, notificationEvent.LeaseUntilUtc })
            .HasFilter("[Status] = 0")
            .HasDatabaseName("IX_NotificationEvents_Pending");

        // Retention cleanup of completed events (oldest first, bounded batches).
        builder.HasIndex(notificationEvent => notificationEvent.CompletedAtUtc, "IX_NotificationEvents_CompletedAtUtc")
            .HasFilter("[CompletedAtUtc] IS NOT NULL");

        // Operations' view of permanently failed events (normally none) - counted by the recovery Job's
        // stats without scanning every retained completed event.
        builder.HasIndex(notificationEvent => notificationEvent.CompletedAtUtc, "IX_NotificationEvents_FailedPermanent")
            .HasFilter("[Status] = 2");
    }
}
