using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionConfiguration : IEntityTypeConfiguration<Collection>
{
    public void Configure(EntityTypeBuilder<Collection> builder)
    {
        builder.ToTable("Collections", "collections");

        builder.HasKey(collection => collection.Id);
        builder.Property(collection => collection.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(collection => collection.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collection => collection.Name)
            .HasColumnType("nvarchar(100)")
            .HasMaxLength(100)
            .IsRequired();

        // Comparison-only - never rendered to the user. Deliberately a separate column from Name
        // rather than a unique index directly on Name, so duplicate-name detection is
        // culture-invariant and independent of the database's default collation (see
        // Collection.NameNormalized and CollectionNameNormalizer) - unlike Categories, whose
        // UX_Categories_UserId_Name unique index relies on the database's default collation.
        builder.Property(collection => collection.NameNormalized)
            .HasColumnType("nvarchar(100)")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(collection => collection.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(collection => collection.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(collection => collection.DeletedAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(collection => collection.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        builder.Property(collection => collection.IsFavorite)
            .HasColumnType("bit")
            .IsRequired()
            .HasDefaultValue(false);

        // Persisted as its string name (not the underlying int) - see CollectionIcon's own remarks
        // on why a future member reorder must never change what an existing row means. Mirrors
        // UserConfiguration's Plan column exactly.
        builder.Property(collection => collection.Icon)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired()
            .HasDefaultValue(CollectionIcon.Folder);

        // Nullable, unlike Icon - deliberately NO default value, so every row that already existed
        // before this column was added stays NULL rather than being backfilled to some color (see
        // Collection.Color's own remarks: NULL is what tells the client to keep using its existing
        // id-deterministic palette fallback instead of an explicit color).
        builder.Property(collection => collection.Color)
            .HasColumnType("varchar(20)");

        builder.HasIndex(collection => new { collection.UserId, collection.CreatedAtUtc, collection.Id })
            .HasDatabaseName("IX_Collections_UserId_CreatedAtUtc_Id");

        builder.HasIndex(collection => new { collection.UserId, collection.DeletedAtUtc, collection.Id })
            .HasDatabaseName("IX_Collections_UserId_DeletedAtUtc_Id");

        builder.HasIndex(collection => new { collection.UserId, collection.NameNormalized })
            .IsUnique()
            .HasDatabaseName("UX_Collections_UserId_NameNormalized");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(collection => collection.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
