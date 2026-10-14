using Juple.Domain.Safety;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Safety;

public sealed class ContentReportConfiguration : IEntityTypeConfiguration<ContentReport>
{
    public void Configure(EntityTypeBuilder<ContentReport> builder)
    {
        builder.ToTable("ContentReports", "safety", table =>
        {
            // Stored by name, so reordering a C# enum never changes what an existing row means; the database refuses unknown names.
            table.HasCheckConstraint("CK_ContentReports_TargetType_Valid", "[TargetType] IN ('User', 'Collection', 'Item', 'Comment')");
            table.HasCheckConstraint(
                "CK_ContentReports_Reason_Valid",
                "[Reason] IN ('Spam', 'Harassment', 'HateOrAbuse', 'SexualOrInappropriate', 'Illegal', 'ScamOrMaliciousLink', 'IntellectualProperty', 'Other')");
            table.HasCheckConstraint("CK_ContentReports_Status_Valid", "[Status] IN ('Pending', 'Reviewed', 'Dismissed', 'Actioned')");
            table.HasCheckConstraint(
                "CK_ContentReports_Review_Consistent",
                "([Status] = 'Pending' AND [ReviewedAtUtc] IS NULL) OR ([Status] <> 'Pending' AND [ReviewedAtUtc] IS NOT NULL)");
        });

        builder.HasKey(report => report.Id);
        builder.Property(report => report.Id).ValueGeneratedOnAdd().UseIdentityColumn();

        // Null once the reporter's account is deleted (the report stays as moderation evidence); there is deliberately no foreign key,
        // so deleting an account never cascades into - or is blocked by - a report.
        builder.Property(report => report.ReporterUserId).HasColumnType("bigint");
        builder.Property(report => report.TargetType).HasConversion<string>().HasColumnType("nvarchar(16)").HasMaxLength(16).IsRequired();
        builder.Property(report => report.TargetId).HasColumnType("bigint").IsRequired();
        builder.Property(report => report.TargetUserId).HasColumnType("bigint");
        builder.Property(report => report.CollectionId).HasColumnType("bigint");
        builder.Property(report => report.Reason).HasConversion<string>().HasColumnType("nvarchar(32)").HasMaxLength(32).IsRequired();
        builder.Property(report => report.Details).HasColumnType("nvarchar(1000)").HasMaxLength(ContentReport.DetailsMaxLength);
        builder.Property(report => report.Status).HasConversion<string>().HasColumnType("nvarchar(16)").HasMaxLength(16).IsRequired();
        builder.Property(report => report.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(report => report.ReviewedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(report => report.Resolution).HasColumnType("nvarchar(1000)").HasMaxLength(ContentReport.ResolutionMaxLength);

        // One OPEN report per reporter and target: reporting the same thing again while it is pending returns the same report.
        builder.HasIndex(report => new { report.ReporterUserId, report.TargetType, report.TargetId })
            .IsUnique()
            .HasFilter("[Status] = 'Pending' AND [ReporterUserId] IS NOT NULL")
            .HasDatabaseName("UX_ContentReports_OpenPerReporterTarget");

        // The moderation queue: oldest pending first.
        builder.HasIndex(report => new { report.Status, report.Id })
            .HasDatabaseName("IX_ContentReports_Status_Id");

        // Account deletion clears / anonymizes the user-id columns explicitly (AccountDeletionStore).
        builder.HasIndex(report => report.ReporterUserId).HasDatabaseName("IX_ContentReports_ReporterUserId");
        builder.HasIndex(report => report.TargetUserId).HasDatabaseName("IX_ContentReports_TargetUserId");
    }
}

public sealed class UserBlockConfiguration : IEntityTypeConfiguration<UserBlock>
{
    public void Configure(EntityTypeBuilder<UserBlock> builder)
    {
        builder.ToTable("UserBlocks", "safety", table =>
            table.HasCheckConstraint("CK_UserBlocks_NotSelf", "[BlockerUserId] <> [BlockedUserId]"));

        builder.HasKey(block => block.Id);
        builder.Property(block => block.Id).ValueGeneratedOnAdd().UseIdentityColumn();
        builder.Property(block => block.BlockerUserId).HasColumnType("bigint").IsRequired();
        builder.Property(block => block.BlockedUserId).HasColumnType("bigint").IsRequired();
        builder.Property(block => block.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        builder.HasIndex(block => new { block.BlockerUserId, block.BlockedUserId })
            .IsUnique()
            .HasDatabaseName("UX_UserBlocks_Blocker_Blocked");

        // "Who blocked me?" for the either-way checks.
        builder.HasIndex(block => new { block.BlockedUserId, block.BlockerUserId })
            .HasDatabaseName("IX_UserBlocks_Blocked_Blocker");

        // Both accounts' deletion removes the row (AccountDeletionStore does it explicitly; NoAction avoids multiple cascade paths).
        builder.HasOne<User>().WithMany().HasForeignKey(block => block.BlockerUserId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<User>().WithMany().HasForeignKey(block => block.BlockedUserId).OnDelete(DeleteBehavior.NoAction);
    }
}
