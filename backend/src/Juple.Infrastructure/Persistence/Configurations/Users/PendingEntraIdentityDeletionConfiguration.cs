using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Users;

public sealed class PendingEntraIdentityDeletionConfiguration : IEntityTypeConfiguration<PendingEntraIdentityDeletion>
{
    public void Configure(EntityTypeBuilder<PendingEntraIdentityDeletion> builder)
    {
        builder.ToTable("PendingEntraIdentityDeletions", "users");

        builder.HasKey(task => task.Id);
        builder.Property(task => task.Id).ValueGeneratedOnAdd().UseIdentityColumn();

        builder.Property(task => task.TenantId).IsRequired();
        builder.Property(task => task.ObjectId).IsRequired();

        builder.Property(task => task.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(task => task.AttemptCount).HasColumnType("int").IsRequired();
        builder.Property(task => task.LastAttemptAtUtc).HasColumnType("datetimeoffset");
        builder.Property(task => task.LastErrorCode).HasColumnType("varchar(100)").IsUnicode(false);

        // One waiting deletion per directory user; also the lookup used before a new account is created for an identity.
        builder.HasIndex(task => new { task.TenantId, task.ObjectId }).IsUnique();
    }
}
