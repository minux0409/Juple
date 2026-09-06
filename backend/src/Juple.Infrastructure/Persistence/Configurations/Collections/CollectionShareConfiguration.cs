using Juple.Domain.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionShareConfiguration : IEntityTypeConfiguration<CollectionShare>
{
    public void Configure(EntityTypeBuilder<CollectionShare> builder)
    {
        builder.ToTable("CollectionShares", "collections");

        builder.HasKey(share => share.Id);
        builder.Property(share => share.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(share => share.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(share => share.PublicId)
            .HasColumnType("nvarchar(32)")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(share => share.IsActive)
            .HasColumnType("bit")
            .IsRequired();

        builder.Property(share => share.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(share => share.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(share => share.RevokedAtUtc)
            .HasColumnType("datetimeoffset");

        // The Public Web Viewer's sole lookup path (GET /api/v1/public/collections/{publicId}) -
        // must be unique so a PublicId can never resolve to more than one Collection.
        builder.HasIndex(share => share.PublicId)
            .IsUnique()
            .HasDatabaseName("UX_CollectionShares_PublicId");

        // At most one ACTIVE share per Collection - a filtered unique index (not a plain unique on
        // CollectionId, which would forever forbid re-sharing after a revoke, since the revoked row
        // would still occupy the slot). Concurrent EnableAsync calls for the same Collection race
        // on this index: the losing INSERT throws a unique-constraint DbUpdateException, which
        // CollectionShareStore.EnableAsync catches and re-reads the winner instead of ever
        // persisting two active rows for one Collection.
        builder.HasIndex(share => share.CollectionId)
            .IsUnique()
            .HasFilter("[IsActive] = 1")
            .HasDatabaseName("UX_CollectionShares_CollectionId_Active");

        // A share is meaningless without its Collection - deleting the Collection must remove its
        // share row(s) too (mirrors CollectionItemConfiguration's Cascade-on-Collection), so a
        // deleted Collection's public link can never keep resolving.
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(share => share.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
