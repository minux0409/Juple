using Juple.Domain.Items;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Items;

public sealed class ItemSaveRequestConfiguration : IEntityTypeConfiguration<ItemSaveRequest>
{
    public void Configure(EntityTypeBuilder<ItemSaveRequest> builder)
    {
        builder.ToTable("ItemSaveRequests", "items", table =>
            table.HasCheckConstraint(
                "CK_ItemSaveRequests_Url_MaxLength",
                "DATALENGTH([Url]) <= 8192"));

        builder.HasKey(request => request.Id);
        builder.Property(request => request.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(request => request.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(request => request.ClientRequestId)
            .HasColumnType("uniqueidentifier")
            .IsRequired();

        // Deliberately not a foreign key: this ledger must survive a future hard-delete of the
        // Item it once created, so ItemId is a historical value only, never enforced by the DB.
        builder.Property(request => request.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(request => request.Url)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096)
            .IsRequired();

        builder.Property(request => request.SavedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.HasIndex(request => new { request.UserId, request.ClientRequestId })
            .IsUnique()
            .HasDatabaseName("UX_ItemSaveRequests_UserId_ClientRequestId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(request => request.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
