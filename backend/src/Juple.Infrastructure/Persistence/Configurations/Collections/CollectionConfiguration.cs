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

        builder.Property(collection => collection.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        builder.HasIndex(collection => new { collection.UserId, collection.CreatedAtUtc, collection.Id })
            .HasDatabaseName("IX_Collections_UserId_CreatedAtUtc_Id");

        builder.HasIndex(collection => new { collection.UserId, collection.NameNormalized })
            .IsUnique()
            .HasDatabaseName("UX_Collections_UserId_NameNormalized");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(collection => collection.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
