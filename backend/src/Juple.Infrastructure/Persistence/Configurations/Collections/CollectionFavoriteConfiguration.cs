using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionFavoriteConfiguration : IEntityTypeConfiguration<CollectionFavorite>
{
    public void Configure(EntityTypeBuilder<CollectionFavorite> builder)
    {
        builder.ToTable("CollectionFavorites", "collections");

        builder.HasKey(favorite => favorite.Id);
        builder.Property(favorite => favorite.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(favorite => favorite.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(favorite => favorite.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(favorite => favorite.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // One mark per user per Collection; also serves "is this Collection my favorite" (the
        // Collection list's per-row EXISTS) and the favorites scope, both keyed by the caller.
        builder.HasIndex(favorite => new { favorite.UserId, favorite.CollectionId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionFavorites_UserId_CollectionId");

        // Backs the Collection cascade below (SQL Server does not index FK columns by itself).
        builder.HasIndex(favorite => favorite.CollectionId)
            .HasDatabaseName("IX_CollectionFavorites_CollectionId");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(favorite => favorite.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(favorite => favorite.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
