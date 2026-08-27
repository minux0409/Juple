using Juple.Domain.Identity;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Identity;

public sealed class ExternalIdentityConfiguration : IEntityTypeConfiguration<ExternalIdentity>
{
    public void Configure(EntityTypeBuilder<ExternalIdentity> builder)
    {
        builder.ToTable("ExternalIdentities", "identity");

        builder.HasKey(identity => identity.Id);
        builder.Property(identity => identity.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(identity => identity.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(identity => identity.TenantId)
            .HasColumnType("uniqueidentifier")
            .IsRequired();

        builder.Property(identity => identity.ObjectId)
            .HasColumnType("uniqueidentifier")
            .IsRequired();

        builder.Property(identity => identity.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.HasIndex(identity => new { identity.TenantId, identity.ObjectId })
            .IsUnique()
            .HasDatabaseName("UX_ExternalIdentities_TenantId_ObjectId");

        builder.HasIndex(identity => identity.UserId)
            .HasDatabaseName("IX_ExternalIdentities_UserId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(identity => identity.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
