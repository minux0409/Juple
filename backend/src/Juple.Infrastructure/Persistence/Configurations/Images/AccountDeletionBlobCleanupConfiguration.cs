using Juple.Domain.Images;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Images;

public sealed class AccountDeletionBlobCleanupConfiguration : IEntityTypeConfiguration<AccountDeletionBlobCleanup>
{
    public void Configure(EntityTypeBuilder<AccountDeletionBlobCleanup> builder)
    {
        builder.ToTable("AccountDeletionBlobCleanups", "images");

        builder.HasKey(cleanup => cleanup.Id);
        builder.Property(cleanup => cleanup.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        // The Blob Storage prefix to delete everything under (e.g. "items/{userId}/") - see
        // ItemImageStore.GetUserBlobPrefix, the single source of truth for this format. No
        // FK/UserId column anywhere on this table by design - see this entity's own remarks.
        builder.Property(cleanup => cleanup.BlobPrefix)
            .HasColumnType("varchar(300)")
            .IsUnicode(false)
            .IsRequired();

        builder.Property(cleanup => cleanup.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(cleanup => cleanup.AttemptCount)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(cleanup => cleanup.LastAttemptAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(cleanup => cleanup.LastErrorCode)
            .HasColumnType("varchar(100)")
            .IsUnicode(false);

        builder.Property(cleanup => cleanup.FinalSweepAfterUtc)
            .HasColumnType("datetimeoffset");
    }
}
