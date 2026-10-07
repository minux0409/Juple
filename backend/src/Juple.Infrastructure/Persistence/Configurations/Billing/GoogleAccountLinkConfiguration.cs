using Juple.Domain.Billing;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Billing;

public sealed class GoogleAccountLinkConfiguration : IEntityTypeConfiguration<GoogleAccountLink>
{
    public void Configure(EntityTypeBuilder<GoogleAccountLink> builder)
    {
        builder.ToTable("GoogleAccountLinks", "billing");

        builder.HasKey(link => link.Id);
        builder.Property(link => link.Id).ValueGeneratedOnAdd().UseIdentityColumn();

        builder.Property(link => link.UserId).IsRequired();
        builder.HasOne<User>().WithMany().HasForeignKey(link => link.UserId).OnDelete(DeleteBehavior.NoAction);

        // Base64Url of a 32-byte HMAC = 43 characters; Google allows up to 64.
        builder.Property(link => link.AccountKey).HasColumnType("varchar(64)").IsUnicode(false).IsRequired();
        builder.Property(link => link.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One opaque id per account, and no two accounts ever share one (the resolution of a notification to an account).
        builder.HasIndex(link => link.UserId).IsUnique().HasDatabaseName("UX_GoogleAccountLinks_UserId");
        builder.HasIndex(link => link.AccountKey).IsUnique().HasDatabaseName("UX_GoogleAccountLinks_AccountKey");
    }
}
