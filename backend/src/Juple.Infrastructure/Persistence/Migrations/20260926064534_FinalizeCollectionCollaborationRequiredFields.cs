using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// CONTRACT half of AddCollectionCollaborationAndLocking: makes Users.PublicCode and
    /// CollectionItems.AddedByUserId NOT NULL, adds the AddedByUserId foreign key and removes the
    /// two transitional defaults. Apply only once the new API revision takes all traffic and no
    /// previous revision writes anymore. Every step is verified first; anything unexpected THROWs
    /// and the whole migration rolls back with nothing changed.
    /// </summary>
    public partial class FinalizeCollectionCollaborationRequiredFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Juple IDs: users inserted by the previous revision already got one from the transitional
            // DEFAULT; this only covers anything that still has none, then verifies the invariant.
            migrationBuilder.Sql(AddCollectionCollaborationAndLocking.BackfillMissingPublicCodesSql);
            migrationBuilder.Sql(
                """
                IF EXISTS (SELECT 1 FROM [users].[Users] WHERE [PublicCode] IS NULL OR LEN([PublicCode]) <> 8)
                    THROW 50002, 'FinalizeCollectionCollaborationRequiredFields aborted: a user has no valid Juple ID. No changes were applied.', 1;
                IF EXISTS (SELECT [PublicCode] FROM [users].[Users] GROUP BY [PublicCode] HAVING COUNT(*) > 1)
                    THROW 50003, 'FinalizeCollectionCollaborationRequiredFields aborted: duplicate Juple IDs. No changes were applied.', 1;
                IF OBJECT_ID(N'[users].[DF_Users_PublicCode_RollingDeploy]', N'D') IS NOT NULL
                    ALTER TABLE [users].[Users] DROP CONSTRAINT [DF_Users_PublicCode_RollingDeploy];
                """);

            // Associations the previous revision inserted (the transitional 0; NULL only if someone
            // inserted one explicitly) were always added by the Collection's Owner with the Owner's
            // own Item - no collaboration existed there. That invariant is verified again for
            // exactly the rows being backfilled, and every remaining value must be a real user
            // before the foreign key is added.
            migrationBuilder.Sql(
                """
                IF EXISTS (
                    SELECT 1
                    FROM [collections].[CollectionItems] AS ci
                    INNER JOIN [collections].[Collections] AS c ON c.[Id] = ci.[CollectionId]
                    INNER JOIN [items].[Items] AS i ON i.[Id] = ci.[ItemId]
                    WHERE (ci.[AddedByUserId] IS NULL OR ci.[AddedByUserId] = 0) AND i.[UserId] <> c.[UserId])
                    THROW 50004, 'FinalizeCollectionCollaborationRequiredFields aborted: a CollectionItems row without AddedByUserId links an Item not owned by its Collection''s owner, so it cannot be backfilled safely. No changes were applied.', 1;

                UPDATE ci
                SET ci.[AddedByUserId] = c.[UserId]
                FROM [collections].[CollectionItems] AS ci
                INNER JOIN [collections].[Collections] AS c ON c.[Id] = ci.[CollectionId]
                WHERE ci.[AddedByUserId] IS NULL OR ci.[AddedByUserId] = 0;

                IF EXISTS (
                    SELECT 1
                    FROM [collections].[CollectionItems] AS ci
                    WHERE ci.[AddedByUserId] IS NULL
                        OR NOT EXISTS (SELECT 1 FROM [users].[Users] AS u WHERE u.[Id] = ci.[AddedByUserId]))
                    THROW 50005, 'FinalizeCollectionCollaborationRequiredFields aborted: a CollectionItems row has no valid AddedByUserId. No changes were applied.', 1;

                IF OBJECT_ID(N'[collections].[DF_CollectionItems_AddedByUserId_RollingDeploy]', N'D') IS NOT NULL
                    ALTER TABLE [collections].[CollectionItems] DROP CONSTRAINT [DF_CollectionItems_AddedByUserId_RollingDeploy];
                """);

            migrationBuilder.DropIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users");

            migrationBuilder.AlterColumn<string>(
                name: "PublicCode",
                schema: "users",
                table: "Users",
                type: "varchar(8)",
                unicode: false,
                maxLength: 8,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(8)",
                oldUnicode: false,
                oldMaxLength: 8,
                oldNullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users",
                column: "PublicCode",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_CollectionItems_Users_AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                column: "AddedByUserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CollectionItems_Users_AddedByUserId",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.DropIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users");

            migrationBuilder.AlterColumn<string>(
                name: "PublicCode",
                schema: "users",
                table: "Users",
                type: "varchar(8)",
                unicode: false,
                maxLength: 8,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(8)",
                oldUnicode: false,
                oldMaxLength: 8);

            migrationBuilder.AlterColumn<long>(
                name: "AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.CreateIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users",
                column: "PublicCode",
                unique: true,
                filter: "[PublicCode] IS NOT NULL");

            // Back to the exact expand state, so a previous revision could write again.
            migrationBuilder.Sql(AddCollectionCollaborationAndLocking.AddPublicCodeRollingDeployDefaultSql);
            migrationBuilder.Sql(AddCollectionCollaborationAndLocking.AddAddedByUserIdRollingDeployDefaultSql);
        }
    }
}
