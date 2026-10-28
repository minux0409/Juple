using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminTranslationWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AnswerDraftLanguage",
                schema: "support",
                table: "SupportInquiries",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AnswerDraftSavedAtUtc",
                schema: "support",
                table: "SupportInquiries",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnswerDraftSourceKo",
                schema: "support",
                table: "SupportInquiries",
                type: "nvarchar(max)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnswerDraftTranslated",
                schema: "support",
                table: "SupportInquiries",
                type: "nvarchar(max)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnswerLanguage",
                schema: "support",
                table: "SupportInquiries",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnswerSourceKo",
                schema: "support",
                table: "SupportInquiries",
                type: "nvarchar(max)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentLanguage",
                schema: "support",
                table: "SupportInquiries",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ContentTranslatedAtUtc",
                schema: "support",
                table: "SupportInquiries",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentTranslationKo",
                schema: "support",
                table: "SupportInquiries",
                type: "nvarchar(max)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Origin",
                schema: "notices",
                table: "NoticeTranslations",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceFingerprint",
                schema: "notices",
                table: "NoticeTranslations",
                type: "varchar(64)",
                unicode: false,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TranslatedAtUtc",
                schema: "notices",
                table: "NoticeTranslations",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_NoticeTranslations_Origin_Valid",
                schema: "notices",
                table: "NoticeTranslations",
                sql: "[Origin] IS NULL OR [Origin] IN ('Source', 'Machine', 'Manual')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NoticeTranslations_Origin_Valid",
                schema: "notices",
                table: "NoticeTranslations");

            migrationBuilder.DropColumn(
                name: "AnswerDraftLanguage",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "AnswerDraftSavedAtUtc",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "AnswerDraftSourceKo",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "AnswerDraftTranslated",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "AnswerLanguage",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "AnswerSourceKo",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "ContentLanguage",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "ContentTranslatedAtUtc",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "ContentTranslationKo",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropColumn(
                name: "Origin",
                schema: "notices",
                table: "NoticeTranslations");

            migrationBuilder.DropColumn(
                name: "SourceFingerprint",
                schema: "notices",
                table: "NoticeTranslations");

            migrationBuilder.DropColumn(
                name: "TranslatedAtUtc",
                schema: "notices",
                table: "NoticeTranslations");
        }
    }
}
