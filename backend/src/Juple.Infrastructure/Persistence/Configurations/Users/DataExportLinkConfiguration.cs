using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Users;

public sealed class DataExportLinkConfiguration : IEntityTypeConfiguration<DataExportLink>
{
    public void Configure(EntityTypeBuilder<DataExportLink> builder)
    {
        builder.ToTable("DataExportLinks", "users", table =>
        {
            table.HasCheckConstraint("CK_DataExportLinks_Part_Valid", "[Part] IN (1, 2)");
            table.HasCheckConstraint(
                "CK_DataExportLinks_ImageRange",
                "([Part] = 1 AND [ImagePartNumber] IS NULL AND [FromImageId] IS NULL AND [ThroughImageId] IS NULL)"
                + " OR ([Part] = 2 AND [ImagePartNumber] >= 1 AND [FromImageId] IS NOT NULL AND [ThroughImageId] >= [FromImageId])");
            table.HasCheckConstraint("CK_DataExportLinks_Expiry", "[ExpiresAtUtc] > [CreatedAtUtc]");
            table.HasCheckConstraint("CK_DataExportLinks_UseCount", "[UseCount] >= 0");
        });

        builder.HasKey(link => link.Id);
        builder.Property(link => link.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(link => link.UserId)
            .IsRequired();

        // SHA-256 of the random token; the token itself is never stored.
        builder.Property(link => link.TokenHash)
            .HasColumnType("binary(32)")
            .IsRequired();

        builder.Property(link => link.Part)
            .HasConversion<byte>()
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(link => link.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(link => link.ExpiresAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(link => link.LastUsedAtUtc)
            .HasColumnType("datetimeoffset");
        builder.Property(link => link.ImagePlanJson).HasColumnType("nvarchar(max)");

        // The download looks a link up by its token hash - one row at most.
        builder.HasIndex(link => link.TokenHash)
            .IsUnique()
            .HasDatabaseName("UX_DataExportLinks_TokenHash");

        // The per-person daily limit: the person's links created since an instant.
        builder.HasIndex(link => new { link.UserId, link.CreatedAtUtc })
            .HasDatabaseName("IX_DataExportLinks_User_CreatedAtUtc");

        // The person's own data: deleting the account deletes its export links.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(link => link.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
