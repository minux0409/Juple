using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionMergeUndo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CollectionMergeOperations",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    OperationToken = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SourceCollectionId = table.Column<long>(type: "bigint", nullable: false),
                    TargetCollectionId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UndoneAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionMergeOperations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionMergeOperations_Collections_SourceCollectionId",
                        column: x => x.SourceCollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CollectionMergeOperations_Collections_TargetCollectionId",
                        column: x => x.TargetCollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CollectionMergeOperations_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "CollectionMergeCreatedMemberships",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    MergeOperationId = table.Column<long>(type: "bigint", nullable: false),
                    CollectionItemId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionMergeCreatedMemberships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionMergeCreatedMemberships_CollectionItems_CollectionItemId",
                        column: x => x.CollectionItemId,
                        principalSchema: "collections",
                        principalTable: "CollectionItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionMergeCreatedMemberships_CollectionMergeOperations_MergeOperationId",
                        column: x => x.MergeOperationId,
                        principalSchema: "collections",
                        principalTable: "CollectionMergeOperations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionMergeCreatedMemberships_MergeOperationId",
                schema: "collections",
                table: "CollectionMergeCreatedMemberships",
                column: "MergeOperationId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionMergeCreatedMemberships_CollectionItemId",
                schema: "collections",
                table: "CollectionMergeCreatedMemberships",
                column: "CollectionItemId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CollectionMergeOperations_SourceCollectionId",
                schema: "collections",
                table: "CollectionMergeOperations",
                column: "SourceCollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionMergeOperations_TargetCollectionId",
                schema: "collections",
                table: "CollectionMergeOperations",
                column: "TargetCollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionMergeOperations_UserId",
                schema: "collections",
                table: "CollectionMergeOperations",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionMergeOperations_OperationToken",
                schema: "collections",
                table: "CollectionMergeOperations",
                column: "OperationToken",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionMergeCreatedMemberships",
                schema: "collections");

            migrationBuilder.DropTable(
                name: "CollectionMergeOperations",
                schema: "collections");
        }
    }
}
