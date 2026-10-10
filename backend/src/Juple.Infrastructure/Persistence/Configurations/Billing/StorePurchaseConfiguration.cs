using Juple.Domain.Billing;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class StorePurchaseConfiguration : IEntityTypeConfiguration<StorePurchase>
{
    public void Configure(EntityTypeBuilder<StorePurchase> builder)
    {
        builder.ToTable("StorePurchases", "billing");

        builder.HasKey(purchase => purchase.Id);
        builder.Property(purchase => purchase.Id).ValueGeneratedOnAdd().UseIdentityColumn();

        // Nullable: a deleted account DETACHES its purchase (the store subscription outlives the Juple account) instead of
        // deleting the only anti-reuse identity. NoAction like every other user FK; account deletion nulls it explicitly.
        builder.Property(purchase => purchase.UserId);
        builder.HasOne<User>().WithMany().HasForeignKey(purchase => purchase.UserId).OnDelete(DeleteBehavior.NoAction);

        builder.Property(purchase => purchase.Source).HasConversion<string>().HasColumnType("varchar(32)").IsRequired();
        builder.Property(purchase => purchase.ProductId).HasColumnType("varchar(200)").IsRequired();
        builder.Property(purchase => purchase.BasePlanId).HasColumnType("varchar(200)");

        // SHA-256 of the purchase token: the identity. The token itself exists ONLY sealed (AES-256-GCM, dedicated billing key).
        builder.Property(purchase => purchase.ExternalKeyHash).HasColumnType("binary(32)").IsRequired();
        builder.Property(purchase => purchase.VerificationHandleEncrypted).HasColumnType("varbinary(2048)");
        builder.Property(purchase => purchase.VerificationHandlePurgedAtUtc).HasColumnType("datetimeoffset");

        builder.Property(purchase => purchase.State).HasConversion<string>().HasColumnType("varchar(32)").IsRequired();
        builder.Property(purchase => purchase.Reason).HasConversion<string>().HasColumnType("varchar(32)").IsRequired();
        builder.Property(purchase => purchase.CurrentPeriodStartUtc).HasColumnType("datetimeoffset");
        builder.Property(purchase => purchase.AccessEndsAtUtc).HasColumnType("datetimeoffset");
        builder.Property(purchase => purchase.AutoRenews);
        builder.Property(purchase => purchase.AcknowledgementPending).IsRequired();
        builder.Property(purchase => purchase.AcknowledgedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(purchase => purchase.LatestVerifiedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(purchase => purchase.NextReconcileAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(purchase => purchase.FirstLinkedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(purchase => purchase.DetachedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(purchase => purchase.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(purchase => purchase.UpdatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(purchase => purchase.RowVersion).IsRowVersion().IsConcurrencyToken();

        // The business invariant: one store purchase belongs to at most one Juple account, and it is also what makes concurrent
        // first verifications converge on one row.
        builder.HasIndex(purchase => new { purchase.Source, purchase.ExternalKeyHash })
            .IsUnique()
            .HasDatabaseName("UX_StorePurchases_Source_ExternalKeyHash");

        // The account's purchases (entitlement reads, restore).
        builder.HasIndex(purchase => purchase.UserId).HasDatabaseName("IX_StorePurchases_UserId");

        // The reconciliation job's "what is due" scan.
        builder.HasIndex(purchase => purchase.NextReconcileAtUtc).HasDatabaseName("IX_StorePurchases_NextReconcileAtUtc");
    }
}
