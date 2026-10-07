using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Users;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users", "users");

        builder.HasKey(user => user.Id);
        builder.Property(user => user.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(user => user.PreferredLocale)
            .HasColumnType("varchar(35)")
            .IsRequired();

        builder.Property(user => user.TimeZoneId)
            .HasColumnType("varchar(100)")
            .IsRequired();

        builder.Property(user => user.DefaultCurrencyCode)
            .HasColumnType("char(3)")
            .IsUnicode(false);

        // Persisted as a stable string (not the enum's underlying int) - see UserPlan's own remarks
        // on why a future member reorder must never change what an existing row means.
        builder.Property(user => user.Plan)
            .HasConversion<string>()
            .HasColumnType("varchar(10)")
            .HasDefaultValue(UserPlan.Free)
            .IsRequired();

        // Nullable with no default and no backfill: a trial exists only once the subscription program is enabled and the
        // account has been evaluated (see EntitlementService) - never from the time a migration happened to run.
        builder.Property(user => user.TrialStartedAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(user => user.TrialEndsAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(user => user.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(user => user.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(user => user.PublicCode)
            .HasColumnType("varchar(8)")
            .HasMaxLength(UserPublicCode.Length)
            .IsUnicode(false)
            .IsRequired();

        // Free text shown to collaborators; Unicode, not unique, not indexed (never searched).
        builder.Property(user => user.DisplayName)
            .HasColumnType($"nvarchar({UserDisplayName.MaxStorageLength})")
            .HasMaxLength(UserDisplayName.MaxStorageLength);

        // Nullable, no default: existing users simply have no photo. Same length as
        // ItemImages.BlobName / Collections.IconImageBlobName (the same naming scheme under the
        // user's own prefix). Not indexed - only ever read with the row it belongs to.
        builder.Property(user => user.ProfileImageBlobName)
            .HasColumnType("nvarchar(400)")
            .HasMaxLength(400);

        // Exact Juple ID lookup (invitations) and the uniqueness invariant itself.
        builder.HasIndex(user => user.PublicCode)
            .IsUnique()
            .HasDatabaseName("UX_Users_PublicCode");

        builder.Property(user => user.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();
    }
}
