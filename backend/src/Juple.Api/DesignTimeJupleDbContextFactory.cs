using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Juple.Api;

/// <summary>Migration metadata only: no API startup, credentials or usable database target. Not used by runtime DI.</summary>
public sealed class DesignTimeJupleDbContextFactory : IDesignTimeDbContextFactory<JupleDbContext>
{
    public JupleDbContext CreateDbContext(string[] args) => new(
        new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer("Server=schema-only.invalid;Database=SchemaOnly;Integrated Security=True;Connect Timeout=1")
            .Options);
}
