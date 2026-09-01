using Juple.Domain.Images;
using Juple.Domain.Items;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Images;

public sealed class ItemImageConfiguration : IEntityTypeConfiguration<ItemImage>
{
    public void Configure(EntityTypeBuilder<ItemImage> builder)
    {
        builder.ToTable("ItemImages", "images", table =>
        {
            table.HasCheckConstraint("CK_ItemImages_ByteLength_Positive", "[ByteLength] > 0");
            table.HasCheckConstraint("CK_ItemImages_SortOrder_NonNegative", "[SortOrder] >= 0");
        });

        builder.HasKey(image => image.Id);
        builder.Property(image => image.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(image => image.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(image => image.BlobName)
            .HasColumnType("nvarchar(400)")
            .HasMaxLength(400)
            .IsRequired();

        builder.Property(image => image.ContentType)
            .HasColumnType("nvarchar(100)")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(image => image.ByteLength)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(image => image.SortOrder)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(image => image.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.HasIndex(image => new { image.ItemId, image.SortOrder, image.Id })
            .HasDatabaseName("IX_ItemImages_ItemId_SortOrder_Id");

        // Blob name collisions are never a valid state, so the database enforces it too, not just
        // whatever generates BlobName values.
        builder.HasIndex(image => image.BlobName)
            .IsUnique()
            .HasDatabaseName("UX_ItemImages_BlobName");

        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(image => image.ItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
