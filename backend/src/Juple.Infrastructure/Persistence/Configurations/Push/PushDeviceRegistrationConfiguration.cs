using Juple.Domain.Push;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Push;

public sealed class PushDeviceRegistrationConfiguration : IEntityTypeConfiguration<PushDeviceRegistration>
{
    public void Configure(EntityTypeBuilder<PushDeviceRegistration> builder)
    {
        builder.ToTable("PushDeviceRegistrations", "push", table =>
        {
            // Same DB-level guard as NotificationConfiguration's CK_Notifications_Type_Valid for its
            // own byte enum - blocks any value outside the currently-defined Platform range.
            table.HasCheckConstraint("CK_PushDeviceRegistrations_Platform_Valid", "[Platform] IN (0, 1)");
        });

        builder.HasKey(registration => registration.Id);
        builder.Property(registration => registration.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(registration => registration.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(registration => registration.Platform)
            .HasColumnType("tinyint")
            .IsRequired();

        // Client-generated (never a hardware fingerprint - see PushDeviceRegistration's own remarks);
        // opaque ASCII identifier, so non-Unicode like Users.TimeZoneId/PreferredLocale.
        builder.Property(registration => registration.InstallationId)
            .HasColumnType("varchar(100)")
            .IsUnicode(false)
            .IsRequired();

        // FCM/APNs tokens are opaque ASCII strings; 1024 gives generous headroom over observed
        // real-world lengths (FCM ~150-250 chars, APNs 64 hex chars) without using nvarchar(max).
        // Treated as a secret - never logged, never returned in full via any API response (see
        // PushDevicesController).
        builder.Property(registration => registration.PushToken)
            .HasColumnType("varchar(1024)")
            .IsUnicode(false)
            .IsRequired();

        // BCP-47-ish app UI language tag (e.g. "ko", "en") - see PushDeviceRegistration.Locale's own
        // remarks on why this, not Users.PreferredLocale, drives push text generation.
        builder.Property(registration => registration.Locale)
            .HasColumnType("varchar(35)")
            .IsUnicode(false)
            .IsRequired();

        builder.Property(registration => registration.IsEnabled)
            .IsRequired();

        builder.Property(registration => registration.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(registration => registration.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(registration => registration.LastSeenAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // The dispatch worker's primary query pattern: enabled devices for a user.
        builder.HasIndex(registration => new { registration.UserId, registration.IsEnabled })
            .HasDatabaseName("IX_PushDeviceRegistrations_UserId_IsEnabled");

        // Globally unique per (Platform, InstallationId), deliberately NOT scoped by UserId - one
        // physical app installation can only ever be actively registered to one Juple user at a
        // time (see PushDeviceRegistration's own remarks and PushDeviceRegistrationStore.
        // RegisterAsync). This is the DB-level guarantee an account switch relies on, not just an
        // application-level check - a concurrent registration race is resolved by this constraint,
        // never by two rows silently coexisting for the same installation.
        builder.HasIndex(registration => new { registration.Platform, registration.InstallationId })
            .IsUnique()
            .HasDatabaseName("UX_PushDeviceRegistrations_Platform_InstallationId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(registration => registration.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
