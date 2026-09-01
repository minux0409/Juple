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

        builder.Property(item => item.ClientRequestId)
            .HasColumnType("uniqueidentifier");

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

        builder.HasIndex(item => new { item.UserId, item.SavedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_SavedAtUtc_Id");

        builder.HasIndex(item => new { item.UserId, item.State, item.StateChangedAtUtc, item.Id })
            .HasDatabaseName("IX_Items_UserId_State_StateChangedAtUtc_Id");

        builder.HasIndex(item => new { item.UserId, item.ClientRequestId })
            .IsUnique()
            .HasDatabaseName("UX_Items_UserId_ClientRequestId")
            .HasFilter("[ClientRequestId] IS NOT NULL");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(item => item.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
