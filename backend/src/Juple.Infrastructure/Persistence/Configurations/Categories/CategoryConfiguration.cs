using Juple.Domain.Categories;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Categories;

public sealed class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        builder.ToTable("Categories", "categories");

        builder.HasKey(category => category.Id);
        builder.Property(category => category.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(category => category.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(category => category.Name)
            .HasColumnType("nvarchar(100)")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(category => category.SortOrder)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(category => category.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        builder.HasIndex(category => new { category.UserId, category.SortOrder, category.Id })
            .HasDatabaseName("IX_Categories_UserId_SortOrder_Id");

        // Relies on the database's default collation for case-sensitivity, matching this project's
        // no-forced-collation convention - a duplicate name check must not silently reimplement
        // normalization the database already enforces (or doesn't).
        builder.HasIndex(category => new { category.UserId, category.Name })
            .IsUnique()
            .HasDatabaseName("UX_Categories_UserId_Name");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(category => category.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
