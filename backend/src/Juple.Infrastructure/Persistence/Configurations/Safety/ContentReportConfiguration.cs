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
            table.HasCheckConstraint("CK_ContentReports_Status_Valid", "[Status] IN ('Pending', 'InReview', 'Reviewed', 'Dismissed', 'Actioned')");
            table.HasCheckConstraint("CK_ContentReports_Source_Valid", "[Source] IN ('User', 'AutoFilter')");
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

        builder.Property(report => report.SnapshotTitle).HasColumnType("nvarchar(300)").HasMaxLength(ContentReport.SnapshotTitleMaxLength);
        builder.Property(report => report.SnapshotUrl).HasColumnType("nvarchar(2048)").HasMaxLength(ContentReport.SnapshotUrlMaxLength);
        // Every row that existed before this column was reported by a person.
        builder.Property(report => report.Source).HasConversion<string>().HasColumnType("nvarchar(16)").HasMaxLength(16).HasDefaultValue(ReportSource.User).IsRequired();
        builder.Property(report => report.ReviewedByAdminUserId).HasColumnType("bigint");

        // One OPEN report per reporter and target: reporting the same thing again while it is pending or in review returns the same report.
        builder.HasIndex(report => new { report.ReporterUserId, report.TargetType, report.TargetId })
            .IsUnique()
            .HasFilter("[Status] IN ('Pending', 'InReview') AND [ReporterUserId] IS NOT NULL")
            .HasDatabaseName("UX_ContentReports_OpenPerReporterTarget");

        // The moderation queue: oldest pending first.
        builder.HasIndex(report => new { report.Status, report.Id })
            .HasDatabaseName("IX_ContentReports_Status_Id");

        // Account deletion clears / anonymizes the user-id columns explicitly (AccountDeletionStore).
        builder.HasIndex(report => report.ReporterUserId).HasDatabaseName("IX_ContentReports_ReporterUserId");
        builder.HasIndex(report => report.TargetUserId).HasDatabaseName("IX_ContentReports_TargetUserId");
        // A report's history in the Admin: the earlier reports of the same thing.
        builder.HasIndex(report => new { report.TargetType, report.TargetId, report.Id }).HasDatabaseName("IX_ContentReports_Target");
    }
}

public sealed class ShareRestrictionConfiguration : IEntityTypeConfiguration<ShareRestriction>
{
    public void Configure(EntityTypeBuilder<ShareRestriction> builder)
    {
        builder.ToTable("ShareRestrictions", "safety");
        builder.HasKey(restriction => restriction.Id);
        builder.Property(restriction => restriction.Id).ValueGeneratedOnAdd().UseIdentityColumn();
        builder.Property(restriction => restriction.CollectionId).HasColumnType("bigint").IsRequired();
        builder.Property(restriction => restriction.ItemId).HasColumnType("bigint");
        builder.Property(restriction => restriction.ReportId).HasColumnType("bigint");
        builder.Property(restriction => restriction.RestrictedByAdminUserId).HasColumnType("bigint").IsRequired();
        builder.Property(restriction => restriction.RestrictedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(restriction => restriction.LiftedByAdminUserId).HasColumnType("bigint");
        builder.Property(restriction => restriction.LiftedAtUtc).HasColumnType("datetimeoffset");

        // At most one decision in force per Collection and per link in a Collection; every access check reads these (small) filtered indexes.
        builder.HasIndex(restriction => restriction.CollectionId)
            .IsUnique()
            .HasFilter("[LiftedAtUtc] IS NULL AND [ItemId] IS NULL")
            .HasDatabaseName("UX_ShareRestrictions_ActiveCollection");
        builder.HasIndex(restriction => new { restriction.CollectionId, restriction.ItemId })
            .IsUnique()
            .HasFilter("[LiftedAtUtc] IS NULL AND [ItemId] IS NOT NULL")
            .HasDatabaseName("UX_ShareRestrictions_ActiveItem");
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

public sealed class ModerationNoticeConfiguration : IEntityTypeConfiguration<ModerationNotice>
{
    public void Configure(EntityTypeBuilder<ModerationNotice> builder)
    {
        builder.ToTable("ModerationNotices", "safety");
        builder.HasKey(notice => notice.Id);
        builder.Property(notice => notice.Id).ValueGeneratedOnAdd().UseIdentityColumn();
        // No foreign keys: a notice belongs to the recipient's account (removed with it, AccountDeletionStore) and must never block a deletion.
        builder.Property(notice => notice.RecipientUserId).HasColumnType("bigint").IsRequired();
        builder.Property(notice => notice.Kind).HasConversion<byte>().HasColumnType("tinyint").IsRequired();
        builder.Property(notice => notice.ReportId).HasColumnType("bigint");
        builder.Property(notice => notice.Reason).HasColumnType("nvarchar(500)").HasMaxLength(ModerationNotice.ReasonMaxLength);
        builder.Property(notice => notice.Guidance).HasColumnType("nvarchar(1000)").HasMaxLength(ModerationNotice.GuidanceMaxLength);
        builder.Property(notice => notice.CreatedByAdminUserId).HasColumnType("bigint");
        builder.Property(notice => notice.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(notice => notice.AcknowledgedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(notice => notice.ActionType).HasConversion<byte?>().HasColumnType("tinyint");
        builder.Property(notice => notice.ContentTitle).HasColumnType("nvarchar(300)").HasMaxLength(ModerationNotice.ContentTitleMaxLength);
        builder.Property(notice => notice.ContentType).HasColumnType("nvarchar(16)").HasMaxLength(16);
        builder.Property(notice => notice.ReasonCode).HasColumnType("nvarchar(32)").HasMaxLength(32);
        builder.Property(notice => notice.DedupKey).HasColumnType("nvarchar(120)").HasMaxLength(120);
        builder.Property(notice => notice.ContentId).HasColumnType("bigint");
        builder.Property(notice => notice.ContentImageUrl).HasColumnType("nvarchar(max)").HasMaxLength(ModerationNotice.ContentImageUrlMaxLength);
        builder.Property(notice => notice.CollectionName).HasColumnType("nvarchar(100)").HasMaxLength(ModerationNotice.CollectionNameMaxLength);

        // One notice of a kind per report and recipient: the duplicate-send guard (a second warning for the same report is a conflict).
        // (Only a warning and a result are "once per report"; an action notice may repeat per report - deleted, then restored - and is guarded by its DedupKey.)
        builder.HasIndex(notice => new { notice.ReportId, notice.RecipientUserId, notice.Kind })
            .IsUnique()
            .HasFilter("[ReportId] IS NOT NULL AND [Kind] IN (1, 2)")
            .HasDatabaseName("UX_ModerationNotices_Report_Recipient_Kind");
        builder.HasIndex(notice => notice.DedupKey)
            .IsUnique()
            .HasFilter("[DedupKey] IS NOT NULL")
            .HasDatabaseName("UX_ModerationNotices_DedupKey");
        builder.HasIndex(notice => notice.RecipientUserId).HasDatabaseName("IX_ModerationNotices_RecipientUserId");
    }
}
