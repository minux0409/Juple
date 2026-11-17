using Juple.Domain.Billing;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class MembershipGrantConfiguration : IEntityTypeConfiguration<MembershipGrant>
{
    public void Configure(EntityTypeBuilder<MembershipGrant> builder)
    {
        builder.ToTable("MembershipGrants", "billing", table =>
        {
            table.HasCheckConstraint("CK_MembershipGrants_Window",
                "([Kind] = 'Preview' AND [EndsAtUtc] IS NULL) OR ([Kind] = 'Complimentary' AND [EndsAtUtc] > [StartsAtUtc] AND [EndsAtUtc] IS NOT NULL)");
            table.HasCheckConstraint("CK_MembershipGrants_Revocation",
                "([RevokedAtUtc] IS NULL AND [RevokedByUserId] IS NULL AND [RevokeReason] IS NULL) OR ([RevokedAtUtc] IS NOT NULL AND [RevokedByUserId] IS NOT NULL AND [RevokeReason] IS NOT NULL)");
        });
        builder.HasKey(grant => grant.Id);
        builder.Property(grant => grant.Id).ValueGeneratedNever();
        builder.Property(grant => grant.Kind).HasConversion<string>().HasMaxLength(20);
        builder.Property(grant => grant.Reason).HasMaxLength(512);
        builder.Property(grant => grant.RevokeReason).HasMaxLength(512);
        builder.HasIndex(grant => new { grant.UserId, grant.Kind, grant.StartsAtUtc });
        builder.HasOne<User>().WithMany().HasForeignKey(grant => grant.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
