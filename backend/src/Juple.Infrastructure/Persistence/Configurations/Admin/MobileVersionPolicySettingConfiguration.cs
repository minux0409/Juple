using Juple.Domain.Admin;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Admin;

public sealed class MobileVersionPolicySettingConfiguration : IEntityTypeConfiguration<MobileVersionPolicySetting>
{
    public void Configure(EntityTypeBuilder<MobileVersionPolicySetting> builder)
    {
        builder.ToTable("MobileVersionPolicies", "admin", table =>
        {
            // At most one row per platform, only the platforms the apps know; the same rules the API validates before saving.
            table.HasCheckConstraint("CK_MobileVersionPolicies_Platform_Valid", "[Platform] IN ('android', 'ios')");
            table.HasCheckConstraint(
                "CK_MobileVersionPolicies_Builds_Valid",
                "[LatestBuild] >= 1 AND [MinimumSupportedBuild] >= 1 AND [MinimumSupportedBuild] <= [LatestBuild]");
        });

        builder.HasKey(setting => setting.Platform);
        builder.Property(setting => setting.Platform)
            .HasColumnType($"varchar({MobileVersionPolicySetting.MaxPlatformLength})")
            .HasMaxLength(MobileVersionPolicySetting.MaxPlatformLength)
            .IsUnicode(false)
            .ValueGeneratedNever();

        builder.Property(setting => setting.LatestBuild)
            .IsRequired();

        builder.Property(setting => setting.MinimumSupportedBuild)
            .IsRequired();

        // No foreign key, like the audit log: the setting outlives the admin's account.
        builder.Property(setting => setting.UpdatedByAdminUserId);

        builder.Property(setting => setting.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(setting => setting.Version)
            .IsRowVersion();
    }
}
