using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Notifications;

public sealed class NotificationDeliveryConfiguration : IEntityTypeConfiguration<NotificationDelivery>
{
    public void Configure(EntityTypeBuilder<NotificationDelivery> builder)
    {
        builder.ToTable("NotificationDeliveries", "notifications", table =>
        {
            table.HasCheckConstraint("CK_NotificationDeliveries_Status_Valid", "[Status] IN (0, 1, 2)");
        });

        builder.HasKey(delivery => delivery.Id);
        builder.Property(delivery => delivery.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(delivery => delivery.NotificationId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(delivery => delivery.PushDeviceRegistrationId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(delivery => delivery.Status)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(delivery => delivery.AttemptCount)
            .HasColumnType("int")
            .IsRequired();

        // Doubles as this row's lease clock while Status is Sending - see NotificationDelivery's
        // own remarks and NotificationDeliveryStore.TryClaimAsync.
        builder.Property(delivery => delivery.AttemptedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(delivery => delivery.ProviderMessageId)
            .HasColumnType("varchar(200)")
            .IsUnicode(false);

        builder.Property(delivery => delivery.FailureCode)
            .HasColumnType("varchar(100)")
            .IsUnicode(false);

        // Dispatch idempotency key - at most one attempt-record per (Notification, Device); a retry
        // updates this same row (see NotificationDelivery.RecordAttempt). The worker's "not yet
        // attempted" candidate query is a NOT EXISTS against this exact index.
        builder.HasIndex(delivery => new { delivery.NotificationId, delivery.PushDeviceRegistrationId })
            .IsUnique()
            .HasDatabaseName("UX_NotificationDeliveries_NotificationId_PushDeviceRegistrationId");

        // A Notification's delivery history is meaningless once the Notification itself is gone -
        // Notification rows are only ever deleted via RepeatPurchase's own Cascade today (see
        // NotificationConfiguration), so this simply follows that same lifecycle.
        builder.HasOne<Notification>()
            .WithMany()
            .HasForeignKey(delivery => delivery.NotificationId)
            .OnDelete(DeleteBehavior.Cascade);

        // A device's delivery history is meaningless once the device registration itself is gone.
        builder.HasOne<PushDeviceRegistration>()
            .WithMany()
            .HasForeignKey(delivery => delivery.PushDeviceRegistrationId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
