using Juple.Domain.Admin;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Admin;

public sealed class AdminAuditLogConfiguration : IEntityTypeConfiguration<AdminAuditLog>
{
    public void Configure(EntityTypeBuilder<AdminAuditLog> builder)
    {
        builder.ToTable("AdminAuditLogs", "admin");

        builder.HasKey(log => log.Id);
        builder.Property(log => log.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        // No foreign keys on purpose: the record must outlive both the admin's account and the target.
        builder.Property(log => log.AdminUserId)
            .IsRequired();

        builder.Property(log => log.Action)
            .HasColumnType($"nvarchar({AdminAuditLog.MaxActionLength})")
            .HasMaxLength(AdminAuditLog.MaxActionLength)
            .IsRequired();

        builder.Property(log => log.TargetType)
            .HasColumnType($"nvarchar({AdminAuditLog.MaxTargetTypeLength})")
            .HasMaxLength(AdminAuditLog.MaxTargetTypeLength)
            .IsRequired();

        builder.Property(log => log.TargetId)
            .HasColumnType($"nvarchar({AdminAuditLog.MaxTargetIdLength})")
            .HasMaxLength(AdminAuditLog.MaxTargetIdLength)
            .IsRequired();

        builder.Property(log => log.Detail)
            .HasColumnType($"nvarchar({AdminAuditLog.MaxDetailLength})")
            .HasMaxLength(AdminAuditLog.MaxDetailLength);

        builder.Property(log => log.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // "What happened to this inquiry", newest first - the one read this table is built for.
        builder.HasIndex(log => new { log.TargetType, log.TargetId, log.Id })
            .HasDatabaseName("IX_AdminAuditLogs_Target");
    }
}
