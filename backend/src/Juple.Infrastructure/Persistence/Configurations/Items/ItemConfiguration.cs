using Juple.Domain.Items;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Items;

public sealed class ItemConfiguration : IEntityTypeConfiguration<Item>
{
    public void Configure(EntityTypeBuilder<Item> builder)
    {
        builder.ToTable("Items", "items", table =>
            table.HasCheckConstraint(
                "CK_Items_Url_MaxLength",
                "DATALENGTH([Url]) <= 8192"));

        builder.HasKey(item => item.Id);
        builder.Property(item => item.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(item => item.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(item => item.Url)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096)
            .IsRequired();

        builder.Property(item => item.SavedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(item => item.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        builder.Property(item => item.Title)
            .HasColumnType("nvarchar(500)")
            .HasMaxLength(500);

        builder.Property(item => item.Memo)
            .HasColumnType("nvarchar(4000)")
            .HasMaxLength(4000);

        // Same column type/max length as Url (not Title/Memo's): nvarchar(max) because SQL Server
        // rejects a sized nvarchar(N) beyond 4000 - HasMaxLength(4096) is still enforced at the EF/
        // app-validation layer even though the storage type is unbounded, exactly like Url. Extracted
        // image URLs (CDN-hosted, often with long signed query strings) can legitimately be as long
        // as a page URL.
        builder.Property(item => item.PreviewImageUrl)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096);

        // Deliberately no FK/index here - see Item.CoverImageId's own remarks (a real FK the other
        // way from ItemImage's existing Item FK would form a cascade cycle SQL Server rejects).
        builder.Property(item => item.CoverImageId)
            .HasColumnType("bigint");

        // Deliberately no default value: existing rows must migrate to NULL (active), never a
        // backfilled non-null value - see Item.DeletedAtUtc's own remarks.
        builder.Property(item => item.DeletedAtUtc)
            .HasColumnType("datetimeoffset");

        builder.HasIndex(item => new { item.UserId, item.SavedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_SavedAtUtc_Id");

        // Supports both the trash list query (UserId + DeletedAtUtc IS NOT NULL, ordered by
        // DeletedAtUtc) and the per-user deleted-item COUNT the retention purge runs after every
        // delete.
        builder.HasIndex(item => new { item.UserId, item.DeletedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_DeletedAtUtc_Id");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(item => item.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
