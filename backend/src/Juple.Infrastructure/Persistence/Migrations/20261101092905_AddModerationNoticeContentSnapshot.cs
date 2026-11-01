using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddModerationNoticeContentSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CollectionName",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ContentId",
                schema: "safety",
                table: "ModerationNotices",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentImageUrl",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(max)",
                maxLength: 4096,
                nullable: true);

            // Notices made before these columns existed: fill what can still be restored from their report and the content. A value already there is kept. Only
            // the content's own person (the recipient is the report's target) is touched; a reporter's result notice (Kind 2) gets none of it.
            // What cannot be restored stays NULL: no title or Collection name is ever made up.
            migrationBuilder.Sql("""
                UPDATE notice
                SET notice.ContentType = COALESCE(notice.ContentType, report.TargetType),
                    notice.ContentId = report.TargetId,
                    notice.ContentTitle = LEFT(COALESCE(notice.ContentTitle, NULLIF(LTRIM(RTRIM(item.Title)), N''), NULLIF(LTRIM(RTRIM(report.SnapshotTitle)), N'')), 300),
                    notice.ContentImageUrl = CASE WHEN item.PreviewImageUrl LIKE N'http://%' OR item.PreviewImageUrl LIKE N'https://%' THEN item.PreviewImageUrl END,
                    notice.CollectionName = collection.Name
                FROM safety.ModerationNotices AS notice
                INNER JOIN safety.ContentReports AS report ON report.Id = notice.ReportId
                LEFT JOIN items.Items AS item ON item.Id = report.TargetId
                LEFT JOIN collections.Collections AS collection ON collection.Id = report.CollectionId
                WHERE notice.Kind IN (1, 3) AND notice.RecipientUserId = report.TargetUserId AND report.TargetType = N'Item';

                UPDATE notice
                SET notice.ContentType = COALESCE(notice.ContentType, report.TargetType),
                    notice.ContentId = report.TargetId,
                    notice.ContentTitle = LEFT(COALESCE(notice.ContentTitle, NULLIF(LTRIM(RTRIM(collection.Name)), N''), NULLIF(LTRIM(RTRIM(report.SnapshotTitle)), N'')), 300)
                FROM safety.ModerationNotices AS notice
                INNER JOIN safety.ContentReports AS report ON report.Id = notice.ReportId
                LEFT JOIN collections.Collections AS collection ON collection.Id = report.TargetId
                WHERE notice.Kind IN (1, 3) AND notice.RecipientUserId = report.TargetUserId AND report.TargetType = N'Collection';

                UPDATE notice
                SET notice.ReasonCode = report.Reason
                FROM safety.ModerationNotices AS notice
                INNER JOIN safety.ContentReports AS report ON report.Id = notice.ReportId
                WHERE notice.Kind IN (1, 3) AND notice.ReasonCode IS NULL AND notice.RecipientUserId = report.TargetUserId;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CollectionName",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ContentId",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ContentImageUrl",
                schema: "safety",
                table: "ModerationNotices");
        }
    }
}
