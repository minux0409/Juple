using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Users;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users", "users");

        builder.HasKey(user => user.Id);
        builder.Property(user => user.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(user => user.PreferredLocale)
            .HasColumnType("varchar(35)")
            .IsRequired();

        builder.Property(user => user.TimeZoneId)
            .HasColumnType("varchar(100)")
            .IsRequired();

        builder.Property(user => user.DefaultCurrencyCode)
            .HasColumnType("char(3)")
            .IsUnicode(false);

        // Persisted as a stable string (not the enum's underlying int) - see UserPlan's own remarks
        // on why a future member reorder must never change what an existing row means.
        builder.Property(user => user.Plan)
            .HasConversion<string>()
            .HasColumnType("varchar(10)")
            .HasDefaultValue(UserPlan.Free)
            .IsRequired();

        builder.Property(user => user.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(user => user.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(user => user.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();
    }
}
