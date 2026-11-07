using Juple.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class AppleAccountLinkConfiguration : IEntityTypeConfiguration<AppleAccountLink>
{
    public void Configure(EntityTypeBuilder<AppleAccountLink> builder)
    {
        builder.ToTable("AppleAccountLinks", "billing");

        builder.HasKey(link => link.Id);
        builder.Property(link => link.Id).ValueGeneratedOnAdd().UseIdentityColumn();
        builder.Property(link => link.UserId).IsRequired();
        builder.Property(link => link.AppAccountToken).IsRequired();
        builder.Property(link => link.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One token per account, and a token can never belong to two accounts. No FK to Users: it is deleted with the account explicitly.
        builder.HasIndex(link => link.UserId).IsUnique().HasDatabaseName("UX_AppleAccountLinks_UserId");
        builder.HasIndex(link => link.AppAccountToken).IsUnique().HasDatabaseName("UX_AppleAccountLinks_AppAccountToken");
    }
}
