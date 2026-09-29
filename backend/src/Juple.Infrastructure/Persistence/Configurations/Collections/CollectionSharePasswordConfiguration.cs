using Juple.Domain.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionSharePasswordConfiguration : IEntityTypeConfiguration<CollectionSharePassword>
{
    public void Configure(EntityTypeBuilder<CollectionSharePassword> builder)
    {
        builder.ToTable("CollectionSharePasswords", "collections");

        builder.HasKey(sharePassword => sharePassword.Id);
        builder.Property(sharePassword => sharePassword.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(sharePassword => sharePassword.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        // Stored by name (like CollectionShare.Permission): a reordered enum never changes a row.
        builder.Property(sharePassword => sharePassword.Mode)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired();

        // ASP.NET Core Identity V3 hash strings are well under this (see CollectionLockPasswordHasher).
        builder.Property(sharePassword => sharePassword.PasswordHash)
            .HasColumnType("nvarchar(512)")
            .HasMaxLength(512);

        // Base64url AES-GCM envelope of a password of at most 64 characters (see
        // CollectionSharePasswordProtector) - comfortably under this.
        builder.Property(sharePassword => sharePassword.EncryptedPassword)
            .HasColumnType("varchar(512)")
            .HasMaxLength(512);

        builder.Property(sharePassword => sharePassword.PasswordVersion)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(sharePassword => sharePassword.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(sharePassword => sharePassword.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // One share-password setting per Collection - also its only lookup path.
        builder.HasIndex(sharePassword => sharePassword.CollectionId)
            .IsUnique()
            .HasDatabaseName("UX_CollectionSharePasswords_CollectionId");

        // Meaningless without its Collection: removed with it (like its shares and memberships).
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(sharePassword => sharePassword.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
