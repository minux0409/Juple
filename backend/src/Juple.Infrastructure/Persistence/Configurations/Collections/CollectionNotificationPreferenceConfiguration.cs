using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionNotificationPreferenceConfiguration : IEntityTypeConfiguration<CollectionNotificationPreference>
{
    public void Configure(EntityTypeBuilder<CollectionNotificationPreference> builder)
    {
        builder.ToTable("CollectionNotificationPreferences", "collections");

        builder.HasKey(preference => preference.Id);
        builder.Property(preference => preference.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(preference => preference.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(preference => preference.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(preference => preference.NewItemNotificationsEnabled)
            .IsRequired();

        builder.Property(preference => preference.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // One setting per user per Collection. Leads with CollectionId: the new-link publisher reads
        // every opted-out recipient of one Collection, and the owner's GET/PUT is (CollectionId, UserId).
        builder.HasIndex(preference => new { preference.CollectionId, preference.UserId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionNotificationPreferences_CollectionId_UserId");

        // Backs the account-deletion delete by UserId (SQL Server does not index FK columns by itself).
        builder.HasIndex(preference => preference.UserId)
            .HasDatabaseName("IX_CollectionNotificationPreferences_UserId");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(preference => preference.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(preference => preference.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
