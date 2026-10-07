using Juple.Domain.Support;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Support;

public sealed class SupportInquiryConfiguration : IEntityTypeConfiguration<SupportInquiry>
{
    public void Configure(EntityTypeBuilder<SupportInquiry> builder)
    {
        builder.ToTable("SupportInquiries", "support", table =>
        {
            // Stored by name, so reordering the C# enum never changes what an existing row means; the database
            // refuses any name this build does not know.
            table.HasCheckConstraint(
                "CK_SupportInquiries_Type_Valid",
                "[Type] IN ('Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other')");
            table.HasCheckConstraint("CK_SupportInquiries_Status_Valid", "[Status] IN ('Pending', 'Answered')");
            // An answered inquiry has an answer and a time; a pending one has neither.
            table.HasCheckConstraint(
                "CK_SupportInquiries_Answer_Consistent",
                "([Status] = 'Pending' AND [Answer] IS NULL AND [AnsweredAtUtc] IS NULL) " +
                "OR ([Status] = 'Answered' AND [Answer] IS NOT NULL AND [AnsweredAtUtc] IS NOT NULL)");
        });

        builder.HasKey(inquiry => inquiry.Id);
        builder.Property(inquiry => inquiry.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(inquiry => inquiry.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(inquiry => inquiry.ClientRequestId)
            .HasColumnType("uniqueidentifier")
            .IsRequired();

        builder.Property(inquiry => inquiry.Type)
            .HasConversion<string>()
            .HasColumnType("nvarchar(32)")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(inquiry => inquiry.Content)
            .HasColumnType("nvarchar(4000)")
            .HasMaxLength(4000)
            .IsRequired();

        builder.Property(inquiry => inquiry.Status)
            .HasConversion<string>()
            .HasColumnType("nvarchar(16)")
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(inquiry => inquiry.Answer)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(8000);

        builder.Property(inquiry => inquiry.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(inquiry => inquiry.AnsweredAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(inquiry => inquiry.AppVersion).HasColumnType("nvarchar(32)").HasMaxLength(32);
        builder.Property(inquiry => inquiry.BuildNumber).HasColumnType("nvarchar(32)").HasMaxLength(32);
        builder.Property(inquiry => inquiry.Platform).HasColumnType("nvarchar(16)").HasMaxLength(16);
        builder.Property(inquiry => inquiry.OsVersion).HasColumnType("nvarchar(32)").HasMaxLength(32);
        builder.Property(inquiry => inquiry.DeviceModel).HasColumnType("nvarchar(100)").HasMaxLength(100);
        builder.Property(inquiry => inquiry.Locale).HasColumnType("nvarchar(35)").HasMaxLength(35);

        // A retried create returns the same row; another user's identical request id is unrelated.
        builder.HasIndex(inquiry => new { inquiry.UserId, inquiry.ClientRequestId })
            .IsUnique()
            .HasDatabaseName("UX_SupportInquiries_UserId_ClientRequestId");

        // The history list: one user's inquiries, newest first, keyset-paged by id.
        builder.HasIndex(inquiry => new { inquiry.UserId, inquiry.Id })
            .HasDatabaseName("IX_SupportInquiries_UserId_Id");

        // Account deletion (AccountDeletionStore) clears these explicitly rather than cascading from User.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(inquiry => inquiry.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
