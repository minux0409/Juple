using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBusinessExpenses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ExpenseAuditLogs",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AdminUserId = table.Column<long>(type: "bigint", nullable: true),
                    Action = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ExpenseId = table.Column<long>(type: "bigint", nullable: true),
                    BeforeJson = table.Column<string>(type: "nvarchar(max)", maxLength: 32000, nullable: true),
                    AfterJson = table.Column<string>(type: "nvarchar(max)", maxLength: 32000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseAuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Expenses",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    DeduplicationKey = table.Column<string>(type: "char(64)", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Provider = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OccurredOn = table.Column<DateOnly>(type: "date", nullable: false),
                    PaidOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Currency = table.Column<string>(type: "char(3)", nullable: false),
                    NetAmount = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: true),
                    TaxAmount = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: true),
                    GrossAmount = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false),
                    PaymentMethod = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    InvoiceReference = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Memo = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    ConvertedCurrency = table.Column<string>(type: "char(3)", nullable: true),
                    ExchangeRate = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: true),
                    ExchangeRateOn = table.Column<DateOnly>(type: "date", nullable: true),
                    OriginalExpenseId = table.Column<long>(type: "bigint", nullable: true),
                    ReconciledByExpenseId = table.Column<long>(type: "bigint", nullable: true),
                    SubscriptionId = table.Column<string>(type: "nvarchar(36)", maxLength: 36, nullable: true),
                    ResourceGroup = table.Column<string>(type: "nvarchar(90)", maxLength: 90, nullable: true),
                    ServiceName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Environment = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    RawImportedAmount = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    NoLongerReported = table.Column<bool>(type: "bit", nullable: false),
                    CreatedByAdminUserId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DeletedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Revision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Expenses", x => x.Id);
                    table.CheckConstraint("CK_Expenses_Amounts", "([NetAmount] IS NULL AND [TaxAmount] IS NULL) OR ([NetAmount] IS NOT NULL AND [TaxAmount] IS NOT NULL AND [NetAmount]+[TaxAmount]=[GrossAmount])");
                    table.CheckConstraint("CK_Expenses_Kind", "[Kind] IN ('Charge','Refund','Adjustment')");
                    table.CheckConstraint("CK_Expenses_Revision", "[Revision] > 0");
                    table.CheckConstraint("CK_Expenses_Source", "[Source] IN ('Manual','Recurring','Azure')");
                    table.CheckConstraint("CK_Expenses_Status", "[Status] IN ('Estimated','Paid','Cancelled')");
                    table.ForeignKey(
                        name: "FK_Expenses_Expenses_OriginalExpenseId",
                        column: x => x.OriginalExpenseId,
                        principalSchema: "admin",
                        principalTable: "Expenses",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Expenses_Expenses_ReconciledByExpenseId",
                        column: x => x.ReconciledByExpenseId,
                        principalSchema: "admin",
                        principalTable: "Expenses",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ExpenseSyncRuns",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Scope = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Environment = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    LeaseKey = table.Column<string>(type: "char(64)", nullable: false),
                    LeaseId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LeaseUntilUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastStartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastSuccessAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    FailureCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    ImportedRows = table.Column<int>(type: "int", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseSyncRuns", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ExpenseAttachments",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ExpenseId = table.Column<long>(type: "bigint", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    BlobName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Sha256 = table.Column<string>(type: "char(64)", nullable: false),
                    Bytes = table.Column<long>(type: "bigint", nullable: false),
                    State = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExpenseAttachments_Expenses_ExpenseId",
                        column: x => x.ExpenseId,
                        principalSchema: "admin",
                        principalTable: "Expenses",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ExpenseRecurringSchedules",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TemplateExpenseId = table.Column<long>(type: "bigint", nullable: false),
                    Frequency = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    NextDueOn = table.Column<DateOnly>(type: "date", nullable: false),
                    AnchorDay = table.Column<int>(type: "int", nullable: false),
                    AnchorMonth = table.Column<int>(type: "int", nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseRecurringSchedules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExpenseRecurringSchedules_Expenses_TemplateExpenseId",
                        column: x => x.TemplateExpenseId,
                        principalSchema: "admin",
                        principalTable: "Expenses",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseAttachments_BlobName",
                schema: "admin",
                table: "ExpenseAttachments",
                column: "BlobName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseAttachments_ExpenseId_Sha256",
                schema: "admin",
                table: "ExpenseAttachments",
                columns: new[] { "ExpenseId", "Sha256" },
                unique: true,
                filter: "[State] <> 'Deleted'");

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseAttachments_RequestId",
                schema: "admin",
                table: "ExpenseAttachments",
                column: "RequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseAttachments_State_CreatedAtUtc",
                schema: "admin",
                table: "ExpenseAttachments",
                columns: new[] { "State", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseAuditLogs_ExpenseId_Id",
                schema: "admin",
                table: "ExpenseAuditLogs",
                columns: new[] { "ExpenseId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseRecurringSchedules_IsEnabled_NextDueOn",
                schema: "admin",
                table: "ExpenseRecurringSchedules",
                columns: new[] { "IsEnabled", "NextDueOn" });

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseRecurringSchedules_TemplateExpenseId",
                schema: "admin",
                table: "ExpenseRecurringSchedules",
                column: "TemplateExpenseId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_DeduplicationKey",
                schema: "admin",
                table: "Expenses",
                column: "DeduplicationKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_OccurredOn_Currency_Status",
                schema: "admin",
                table: "Expenses",
                columns: new[] { "OccurredOn", "Currency", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_OriginalExpenseId",
                schema: "admin",
                table: "Expenses",
                column: "OriginalExpenseId");

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_ReconciledByExpenseId",
                schema: "admin",
                table: "Expenses",
                column: "ReconciledByExpenseId");

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_RequestId",
                schema: "admin",
                table: "Expenses",
                column: "RequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseSyncRuns_LeaseKey",
                schema: "admin",
                table: "ExpenseSyncRuns",
                column: "LeaseKey",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExpenseAttachments",
                schema: "admin");

            migrationBuilder.DropTable(
                name: "ExpenseAuditLogs",
                schema: "admin");

            migrationBuilder.DropTable(
                name: "ExpenseRecurringSchedules",
                schema: "admin");

            migrationBuilder.DropTable(
                name: "ExpenseSyncRuns",
                schema: "admin");

            migrationBuilder.DropTable(
                name: "Expenses",
                schema: "admin");
        }
    }
}
