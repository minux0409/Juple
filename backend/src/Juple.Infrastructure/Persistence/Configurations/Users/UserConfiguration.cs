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
