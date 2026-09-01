using Juple.Domain.Categories;
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

        builder.Property(item => item.State)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(item => item.StateChangedAtUtc)
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

        builder.Property(item => item.CategoryId)
            .HasColumnType("bigint");

        builder.HasIndex(item => new { item.UserId, item.SavedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_SavedAtUtc_Id");

        builder.HasIndex(item => new { item.UserId, item.State, item.StateChangedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_State_StateChangedAtUtc_Id");

        builder.HasIndex(item => item.CategoryId)
            .HasDatabaseName("IX_Items_CategoryId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(item => item.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        // Deleting a Category must never delete the Items that reference it - only detach the
        // reference (SET NULL is safe here precisely because it never removes a row, unlike a
        // cascade delete crossing the Items/Categories module boundary would).
        builder.HasOne<Category>()
            .WithMany()
            .HasForeignKey(item => item.CategoryId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
