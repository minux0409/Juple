using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionSharePasswords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CollectionSharePasswords",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    Mode = table.Column<string>(type: "varchar(20)", nullable: false),
                    PasswordHash = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    EncryptedPassword = table.Column<string>(type: "varchar(512)", maxLength: 512, nullable: true),
                    PasswordVersion = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionSharePasswords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionSharePasswords_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_CollectionSharePasswords_CollectionId",
                schema: "collections",
                table: "CollectionSharePasswords",
                column: "CollectionId",
                unique: true);

            // Until now a locked Collection asked every recipient - members and public-link visitors -
            // for its Owner's lock password. Recipients are no longer asked for that password, so a
            // Collection that is locked AND already has recipients keeps exactly that protection as the
            // legacy mode (see CollectionSharePasswordMode.LegacyCommonLock) instead of silently losing
            // it. "Has recipients" = an accepted member, an active public link, or an invitation that
            // can still be accepted (Pending and unexpired - an expired one can no longer be, see
            // CollectionInvitation.IsPendingAt). A locked Collection with none of these never had anyone
            // to protect from, so it gets no row - the same as Mode None - and only its Owner's lock
            // applies, as before. Soft-deleted Collections follow the same rule: deletion keeps their
            // members and link and Restore brings them back unchanged, so their recipients are real.
            // Nothing is copied or derived from any password hash; the Owner can later replace the
            // legacy mode with the Collection's own share password, or remove it.
            migrationBuilder.Sql("""
                INSERT INTO [collections].[CollectionSharePasswords]
                    ([CollectionId], [Mode], [PasswordHash], [EncryptedPassword], [PasswordVersion], [CreatedAtUtc], [UpdatedAtUtc])
                SELECT [c].[Id], 'LegacyCommonLock', NULL, NULL, 1, SWITCHOFFSET(SYSDATETIMEOFFSET(), '+00:00'), SWITCHOFFSET(SYSDATETIMEOFFSET(), '+00:00')
                FROM [collections].[Collections] AS [c]
                WHERE [c].[IsLocked] = 1
                    AND (
                        EXISTS (SELECT 1 FROM [collections].[CollectionCollaborators] AS [m] WHERE [m].[CollectionId] = [c].[Id])
                        OR EXISTS (SELECT 1 FROM [collections].[CollectionShares] AS [s] WHERE [s].[CollectionId] = [c].[Id] AND [s].[IsActive] = 1)
                        OR EXISTS (
                            SELECT 1 FROM [collections].[CollectionInvitations] AS [i]
                            WHERE [i].[CollectionId] = [c].[Id] AND [i].[Status] = 'Pending' AND [i].[ExpiresAtUtc] > SYSDATETIMEOFFSET()));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionSharePasswords",
                schema: "collections");
        }
    }
}
