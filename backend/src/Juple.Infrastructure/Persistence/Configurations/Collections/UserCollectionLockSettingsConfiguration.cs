using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class UserCollectionLockSettingsConfiguration : IEntityTypeConfiguration<UserCollectionLockSettings>
{
    public void Configure(EntityTypeBuilder<UserCollectionLockSettings> builder)
    {
        builder.ToTable("UserCollectionLockSettings", "collections");

        // At most one row per user: the key is the user itself, never generated.
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId)
            .HasColumnType("bigint")
            .ValueGeneratedNever();

        // Versioned PBKDF2 hash string (see CollectionLockPasswordHasher) - same shape as
        // Collections.LockPasswordHash.
        builder.Property(settings => settings.PasswordHash)
            .HasColumnType("varchar(200)")
            .HasMaxLength(200)
            .IsUnicode(false)
            .IsRequired();

        builder.Property(settings => settings.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(settings => settings.PasswordChangedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(settings => settings.FailedChangeAttemptCount)
            .HasColumnType("int")
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(settings => settings.FailedChangeWindowStartedAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(settings => settings.RowVersion)
            .IsRowVersion();

        // NoAction like every other UserId FK - AccountDeletionStore clears this row explicitly.
        builder.HasOne<User>()
            .WithOne()
            .HasForeignKey<UserCollectionLockSettings>(settings => settings.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
