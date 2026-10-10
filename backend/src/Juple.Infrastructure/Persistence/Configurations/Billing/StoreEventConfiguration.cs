using Juple.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class StoreEventConfiguration : IEntityTypeConfiguration<StoreEvent>
{
    public void Configure(EntityTypeBuilder<StoreEvent> builder)
    {
        builder.ToTable("StoreEvents", "billing");

        builder.HasKey(storeEvent => storeEvent.Id);
        builder.Property(storeEvent => storeEvent.Id).ValueGeneratedOnAdd().UseIdentityColumn();

        builder.Property(storeEvent => storeEvent.Source).HasConversion<string>().HasColumnType("varchar(32)").IsRequired();
        builder.Property(storeEvent => storeEvent.ExternalEventId).HasColumnType("varchar(200)").IsRequired();
        builder.Property(storeEvent => storeEvent.EventType).HasColumnType("varchar(64)").IsRequired();
        builder.Property(storeEvent => storeEvent.TokenHash).HasColumnType("binary(32)");
        // Sealed, and cleared as soon as the event is processed. There is deliberately NO column for the notification body,
        // the Authorization header or the OIDC token.
        builder.Property(storeEvent => storeEvent.EncryptedToken).HasColumnType("varbinary(2048)");
        builder.Property(storeEvent => storeEvent.ReceivedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(storeEvent => storeEvent.DispatchedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(storeEvent => storeEvent.ProcessedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(storeEvent => storeEvent.AttemptCount).IsRequired();
        builder.Property(storeEvent => storeEvent.NextAttemptAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(storeEvent => storeEvent.Result).HasConversion<string>().HasColumnType("varchar(32)").IsRequired();
        builder.Property(storeEvent => storeEvent.LastErrorCode).HasColumnType("varchar(64)");

        // Idempotency: a redelivered or concurrent notification (same Pub/Sub message id) is the same event.
        builder.HasIndex(storeEvent => new { storeEvent.Source, storeEvent.ExternalEventId })
            .IsUnique()
            .HasDatabaseName("UX_StoreEvents_Source_ExternalEventId");

        // The sweep: events not yet processed, oldest due first.
        // Retention cleanup of processed events, oldest first (see RetentionCleanupService).
        builder.HasIndex(storeEvent => storeEvent.ProcessedAtUtc)
            .HasFilter("[ProcessedAtUtc] IS NOT NULL")
            .HasDatabaseName("IX_StoreEvents_ProcessedAtUtc");

        builder.HasIndex(storeEvent => storeEvent.NextAttemptAtUtc)
            .HasFilter("[ProcessedAtUtc] IS NULL")
            .HasDatabaseName("IX_StoreEvents_Unprocessed_NextAttemptAtUtc");
    }
}
