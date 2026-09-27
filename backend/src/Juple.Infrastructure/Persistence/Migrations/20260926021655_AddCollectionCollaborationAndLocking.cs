using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionCollaborationAndLocking : Migration
    {
        /// <summary>
        /// Gives every user without a Juple ID one (same format as UserPublicCode.Generate, exact
        /// rejection sampling, uniqueness-checked). Idempotent - also run by the contract migration
        /// for any row that still lacks one.
        /// </summary>
        internal const string BackfillMissingPublicCodesSql =
            """
                DECLARE @alphabet char(31) = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
                DECLARE @userId bigint;
                DECLARE @code varchar(8);
                DECLARE @random varbinary(64);
                DECLARE @position int;
                DECLARE @byte int;

                DECLARE users_without_code CURSOR LOCAL STATIC FORWARD_ONLY READ_ONLY FOR
                    SELECT [Id] FROM [users].[Users] WHERE [PublicCode] IS NULL;
                OPEN users_without_code;
                FETCH NEXT FROM users_without_code INTO @userId;
                WHILE @@FETCH_STATUS = 0
                BEGIN
                    WHILE 1 = 1
                    BEGIN
                        SET @code = '';
                        WHILE LEN(@code) < 8
                        BEGIN
                            SET @random = CRYPT_GEN_RANDOM(64);
                            SET @position = 1;
                            WHILE @position <= 64 AND LEN(@code) < 8
                            BEGIN
                                SET @byte = CAST(SUBSTRING(@random, @position, 1) AS int);
                                IF @byte < 248
                                    SET @code = @code + SUBSTRING(@alphabet, (@byte % 31) + 1, 1);
                                SET @position = @position + 1;
                            END
                        END

                        IF NOT EXISTS (SELECT 1 FROM [users].[Users] WHERE [PublicCode] = @code)
                            BREAK;
                    END

                    UPDATE [users].[Users] SET [PublicCode] = @code WHERE [Id] = @userId;
                    FETCH NEXT FROM users_without_code INTO @userId;
                END
                CLOSE users_without_code;
                DEALLOCATE users_without_code;
            """;

        /// <summary>The transitional Juple ID default for users inserted by the previous API revision (see Up).</summary>
        internal const string AddPublicCodeRollingDeployDefaultSql =
            """
                ALTER TABLE [users].[Users] ADD CONSTRAINT [DF_Users_PublicCode_RollingDeploy] DEFAULT (
                    SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                    + SUBSTRING('23456789ABCDEFGHJKMNPQRSTUVWXYZ', CAST(CAST(CRYPT_GEN_RANDOM(4) AS bigint) % 31 AS int) + 1, 1)
                ) FOR [PublicCode];
            """;

        /// <summary>
        /// Transitional marker for associations inserted by the previous API revision (see Up): 0 is
        /// never a real user, so such a row matches no "added by this user" filter until the
        /// contract migration records its Owner.
        /// </summary>
        internal const string AddAddedByUserIdRollingDeployDefaultSql =
            "ALTER TABLE [collections].[CollectionItems] ADD CONSTRAINT [DF_CollectionItems_AddedByUserId_RollingDeploy] DEFAULT (CAST(0 AS bigint)) FOR [AddedByUserId];";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // EXPAND half of an expand/contract pair (contract: FinalizeCollectionCollaborationRequiredFields).
            // Everything here is additive and must keep the PREVIOUS API revision (which knows
            // nothing about these columns) fully working for reads and writes while a rolling
            // deployment is in progress - so the two columns that end up required are added
            // nullable here and only made NOT NULL by the contract migration, once no old revision
            // writes anymore.
            //
            // Juple ID for every existing user: added nullable, backfilled with random codes of the
            // exact same format as UserPublicCode.Generate (8 chars from the 31-symbol alphabet
            // without 0/O/1/I/L, CSPRNG bytes via CRYPT_GEN_RANDOM, rejection sampling so there is
            // no modulo bias), each checked for uniqueness before it is written, and uniquely
            // indexed among non-NULL values (UX_Users_PublicCode below). Runs inside the
            // migration's transaction: any failure leaves no half-assigned state.
            migrationBuilder.AddColumn<string>(
                name: "PublicCode",
                schema: "users",
                table: "Users",
                type: "varchar(8)",
                unicode: false,
                maxLength: 8,
                nullable: true);

            migrationBuilder.Sql(BackfillMissingPublicCodesSql);

            // Transitional only (dropped by the contract migration, never part of the EF model): a
            // user created by the previous API revision - which never sends PublicCode - still gets
            // a Juple ID of the same format, so no user ever exists without one and the new
            // revision never has to handle a missing code. Each character takes 32 CSPRNG bits
            // modulo 31, a bias below 10^-9 (the backfill above uses exact rejection sampling; a
            // DEFAULT cannot loop). A collision with an existing code fails that one insert on
            // UX_Users_PublicCode rather than duplicating a code (about 1 in 10^11 per existing user).
            migrationBuilder.Sql(AddPublicCodeRollingDeployDefaultSql);

            migrationBuilder.AddColumn<bool>(
                name: "IsLocked",
                schema: "collections",
                table: "Collections",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LockPasswordChangedAtUtc",
                schema: "collections",
                table: "Collections",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LockPasswordHash",
                schema: "collections",
                table: "Collections",
                type: "varchar(200)",
                unicode: false,
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LockVersion",
                schema: "collections",
                table: "Collections",
                type: "int",
                nullable: false,
                defaultValue: 0);

            // Who added each existing association. Before this migration every association was
            // created only by its Collection's Owner, with the Owner's own Item (all four creation
            // paths - add, transfer, undo-transfer, merge - required both). That invariant is
            // verified here rather than assumed: if any row violates it the migration aborts
            // (THROW rolls the whole migration back) instead of recording a wrong AddedByUserId.
            // Not NOT NULL (nor a foreign key) until the contract migration: the previous API
            // revision keeps inserting associations without it during a rolling deployment. Those
            // get the transitional 0 below instead of NULL, because the new revision maps the
            // column as required (a NULL would fail to load, 0 loads and matches no user); the
            // new revision itself always writes the real caller.
            migrationBuilder.AddColumn<long>(
                name: "AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                type: "bigint",
                nullable: true);

            migrationBuilder.Sql(
                """
                IF EXISTS (
                    SELECT 1
                    FROM [collections].[CollectionItems] AS ci
                    INNER JOIN [collections].[Collections] AS c ON c.[Id] = ci.[CollectionId]
                    INNER JOIN [items].[Items] AS i ON i.[Id] = ci.[ItemId]
                    WHERE i.[UserId] <> c.[UserId])
                    THROW 50001, 'AddCollectionCollaborationAndLocking aborted: a CollectionItems row links an Item not owned by its Collection''s owner, so AddedByUserId cannot be backfilled safely. No changes were applied.', 1;

                UPDATE ci
                SET ci.[AddedByUserId] = c.[UserId]
                FROM [collections].[CollectionItems] AS ci
                INNER JOIN [collections].[Collections] AS c ON c.[Id] = ci.[CollectionId]
                WHERE ci.[AddedByUserId] IS NULL;
                """);

            migrationBuilder.Sql(AddAddedByUserIdRollingDeployDefaultSql);

            migrationBuilder.CreateTable(
                name: "CollectionCollaborators",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Role = table.Column<string>(type: "varchar(20)", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedByUserId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionCollaborators", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionCollaborators_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionCollaborators_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CollectionCollaborators_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "CollectionInvitations",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    InvitedUserId = table.Column<long>(type: "bigint", nullable: false),
                    InvitedByUserId = table.Column<long>(type: "bigint", nullable: false),
                    Role = table.Column<string>(type: "varchar(20)", nullable: false),
                    Status = table.Column<string>(type: "varchar(20)", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RespondedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionInvitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionInvitations_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionInvitations_Users_InvitedByUserId",
                        column: x => x.InvitedByUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CollectionInvitations_Users_InvitedUserId",
                        column: x => x.InvitedUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "CollectionUnlockThrottles",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    SubjectKey = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    FailedAttemptCount = table.Column<int>(type: "int", nullable: false),
                    WindowStartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionUnlockThrottles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionUnlockThrottles_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users",
                column: "PublicCode",
                unique: true,
                filter: "[PublicCode] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItems_AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                column: "AddedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItems_CollectionId_AddedByUserId",
                schema: "collections",
                table: "CollectionItems",
                columns: new[] { "CollectionId", "AddedByUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionCollaborators_CreatedByUserId",
                schema: "collections",
                table: "CollectionCollaborators",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionCollaborators_UserId_CollectionId",
                schema: "collections",
                table: "CollectionCollaborators",
                columns: new[] { "UserId", "CollectionId" });

            migrationBuilder.CreateIndex(
                name: "UX_CollectionCollaborators_CollectionId_UserId",
                schema: "collections",
                table: "CollectionCollaborators",
                columns: new[] { "CollectionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CollectionInvitations_CollectionId_Status",
                schema: "collections",
                table: "CollectionInvitations",
                columns: new[] { "CollectionId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionInvitations_InvitedByUserId",
                schema: "collections",
                table: "CollectionInvitations",
                column: "InvitedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionInvitations_InvitedUserId_Status",
                schema: "collections",
                table: "CollectionInvitations",
                columns: new[] { "InvitedUserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "UX_CollectionInvitations_CollectionId_InvitedUserId_Pending",
                schema: "collections",
                table: "CollectionInvitations",
                columns: new[] { "CollectionId", "InvitedUserId" },
                unique: true,
                filter: "[Status] = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionUnlockThrottles_CollectionId_SubjectKey",
                schema: "collections",
                table: "CollectionUnlockThrottles",
                columns: new[] { "CollectionId", "SubjectKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionCollaborators",
                schema: "collections");

            migrationBuilder.DropTable(
                name: "CollectionInvitations",
                schema: "collections");

            migrationBuilder.DropTable(
                name: "CollectionUnlockThrottles",
                schema: "collections");

            migrationBuilder.DropIndex(
                name: "UX_Users_PublicCode",
                schema: "users",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_CollectionItems_AddedByUserId",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.DropIndex(
                name: "IX_CollectionItems_CollectionId_AddedByUserId",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.DropColumn(
                name: "PublicCode",
                schema: "users",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IsLocked",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "LockPasswordChangedAtUtc",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "LockPasswordHash",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "LockVersion",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "AddedByUserId",
                schema: "collections",
                table: "CollectionItems");
        }
    }
}
