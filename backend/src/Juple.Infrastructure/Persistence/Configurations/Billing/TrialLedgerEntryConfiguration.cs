using Juple.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class TrialLedgerEntryConfiguration : IEntityTypeConfiguration<TrialLedgerEntry>
{
    public void Configure(EntityTypeBuilder<TrialLedgerEntry> builder)
    {
        builder.ToTable("TrialLedger", "billing");

        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        // HMAC-SHA256 output: exactly 32 bytes. No raw tenant/object id, email or name is stored anywhere here.
        builder.Property(entry => entry.IdentityHash)
            .HasColumnType("binary(32)")
            .IsRequired();

        builder.Property(entry => entry.TrialStartedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(entry => entry.TrialEndsAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(entry => entry.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // The business invariant: one trial per external identity - and what makes concurrent first calls converge.
        // Deliberately NO foreign key to users.Users: this row must survive account deletion.
        builder.HasIndex(entry => entry.IdentityHash)
            .IsUnique()
            .HasDatabaseName("UX_TrialLedger_IdentityHash");
    }
}
