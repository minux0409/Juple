using Juple.Domain.Expenses;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Admin;

public sealed class ExpenseConfiguration : IEntityTypeConfiguration<Expense>, IEntityTypeConfiguration<ExpenseRecurringSchedule>,
    IEntityTypeConfiguration<ExpenseAttachment>, IEntityTypeConfiguration<ExpenseAuditLog>, IEntityTypeConfiguration<ExpenseSyncRun>
{
    public void Configure(EntityTypeBuilder<Expense> b)
    {
        b.ToTable("Expenses", "admin", table => {
            table.HasCheckConstraint("CK_Expenses_Status", "[Status] IN ('Estimated','Paid','Cancelled')");
            table.HasCheckConstraint("CK_Expenses_Source", "[Source] IN ('Manual','Recurring','Azure')");
            table.HasCheckConstraint("CK_Expenses_Kind", "[Kind] IN ('Charge','Refund','Adjustment')");
            table.HasCheckConstraint("CK_Expenses_Amounts", "([NetAmount] IS NULL AND [TaxAmount] IS NULL) OR ([NetAmount] IS NOT NULL AND [TaxAmount] IS NOT NULL AND [NetAmount]+[TaxAmount]=[GrossAmount])");
            table.HasCheckConstraint("CK_Expenses_Revision", "[Revision] > 0");
        });
        b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.Revision).IsConcurrencyToken();
        b.HasIndex(x => x.RequestId).IsUnique(); b.HasIndex(x => x.DeduplicationKey).IsUnique();
        b.HasIndex(x => new { x.OccurredOn, x.Currency, x.Status });
        b.HasIndex(x => x.ReconciledByExpenseId); b.HasIndex(x => x.OriginalExpenseId);
        b.Property(x => x.DeduplicationKey).HasColumnType("char(64)");
        b.Property(x => x.Name).HasMaxLength(200); b.Property(x => x.Provider).HasMaxLength(200);
        b.Property(x => x.Category).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
        b.Property(x => x.Currency).HasColumnType("char(3)"); b.Property(x => x.ConvertedCurrency).HasColumnType("char(3)");
        b.Property(x => x.NetAmount).HasPrecision(28, 12); b.Property(x => x.TaxAmount).HasPrecision(28, 12);
        b.Property(x => x.GrossAmount).HasPrecision(28, 12); b.Property(x => x.ExchangeRate).HasPrecision(28, 12);
        b.Property(x => x.PaymentMethod).HasMaxLength(80); b.Property(x => x.InvoiceReference).HasMaxLength(200);
        b.Property(x => x.Memo).HasMaxLength(2000); b.Property(x => x.SubscriptionId).HasMaxLength(36);
        b.Property(x => x.ResourceGroup).HasMaxLength(90); b.Property(x => x.ServiceName).HasMaxLength(200);
        b.Property(x => x.Environment).HasMaxLength(32); b.Property(x => x.RawImportedAmount).HasMaxLength(64);
        b.HasOne<Expense>().WithMany().HasForeignKey(x => x.ReconciledByExpenseId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<Expense>().WithMany().HasForeignKey(x => x.OriginalExpenseId).OnDelete(DeleteBehavior.NoAction);
    }
    public void Configure(EntityTypeBuilder<ExpenseRecurringSchedule> b)
    {
        b.ToTable("ExpenseRecurringSchedules", "admin"); b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.Frequency).HasConversion<string>().HasMaxLength(16); b.Property(x => x.Revision).IsConcurrencyToken();
        b.HasIndex(x => x.TemplateExpenseId).IsUnique(); b.HasIndex(x => new { x.IsEnabled, x.NextDueOn });
        b.HasOne<Expense>().WithMany().HasForeignKey(x => x.TemplateExpenseId).OnDelete(DeleteBehavior.NoAction);
    }
    public void Configure(EntityTypeBuilder<ExpenseAttachment> b)
    {
        b.ToTable("ExpenseAttachments", "admin"); b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.FileName).HasMaxLength(120); b.Property(x => x.ContentType).HasMaxLength(64);
        b.Property(x => x.BlobName).HasMaxLength(200); b.Property(x => x.Sha256).HasColumnType("char(64)");
        b.Property(x => x.State).HasConversion<string>().HasMaxLength(24);
        b.HasIndex(x => x.RequestId).IsUnique(); b.HasIndex(x => x.BlobName).IsUnique();
        b.HasIndex(x => new { x.ExpenseId, x.Sha256 }).IsUnique().HasFilter("[State] <> 'Deleted'");
        b.HasIndex(x => new { x.State, x.CreatedAtUtc });
        b.HasOne<Expense>().WithMany().HasForeignKey(x => x.ExpenseId).OnDelete(DeleteBehavior.NoAction);
    }
    public void Configure(EntityTypeBuilder<ExpenseAuditLog> b)
    {
        b.ToTable("ExpenseAuditLogs", "admin"); b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.Action).HasMaxLength(64); b.Property(x => x.BeforeJson).HasMaxLength(32000); b.Property(x => x.AfterJson).HasMaxLength(32000);
        b.HasIndex(x => new { x.ExpenseId, x.Id });
    }
    public void Configure(EntityTypeBuilder<ExpenseSyncRun> b)
    {
        b.ToTable("ExpenseSyncRuns", "admin"); b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.LeaseKey).HasColumnType("char(64)"); b.HasIndex(x => x.LeaseKey).IsUnique();
        b.Property(x => x.Scope).HasMaxLength(256); b.Property(x => x.Environment).HasMaxLength(32);
        b.Property(x => x.Status).HasMaxLength(16); b.Property(x => x.FailureCode).HasMaxLength(64);
        b.Property(x => x.Revision).IsConcurrencyToken();
    }
}
