param(
    [string] $Filter = 'FullyQualifiedName~DataExport|FullyQualifiedName~DataRetentionDeletionPlan',
    [switch] $Detailed
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$password = $env:MSSQL_SA_PASSWORD
if (-not $password) { throw 'Set MSSQL_SA_PASSWORD for the existing local compose SQL Server; never supply a remote connection.' }
$previousSql = $env:ConnectionStrings__JupleDatabase
$previousBlob = $env:ConnectionStrings__BlobStorage
$runner = Join-Path $repo 'backend/tests/Juple.IntegrationTests/obj/ret-local-migration'
New-Item -ItemType Directory -Path $runner -Force | Out-Null
$infrastructure = [System.Security.SecurityElement]::Escape((Join-Path $repo 'backend/src/Juple.Infrastructure/Juple.Infrastructure.csproj'))
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><NuGetAudit>false</NuGetAudit></PropertyGroup>
  <ItemGroup><ProjectReference Include="$infrastructure" /></ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $runner 'Migrate.csproj')
@'
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
var connection = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase");
var target = new SqlConnectionStringBuilder(connection);
if (target.DataSource != "localhost,14333" || target.InitialCatalog != "JupleRetTests")
    throw new InvalidOperationException("Only localhost,14333/JupleRetTests may be migrated by this runner.");
await using var db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connection).Options);
await db.Database.MigrateAsync();
Console.WriteLine("Local RET test schema ready; pending migrations: " + (await db.Database.GetPendingMigrationsAsync()).Count());
'@ | Set-Content -LiteralPath (Join-Path $runner 'Program.cs')
try {
    $quotedPassword = $password.Replace('"', '""')
    $env:ConnectionStrings__JupleDatabase = "Server=localhost,14333;Database=JupleRetTests;User Id=sa;Password=`"$quotedPassword`";Encrypt=True;TrustServerCertificate=True"
    $env:ConnectionStrings__BlobStorage = 'UseDevelopmentStorage=true'
    dotnet build (Join-Path $runner 'Migrate.csproj') -m:1 -p:NuGetAudit=false
    if ($LASTEXITCODE -ne 0) { throw 'Local migration runner build failed.' }
    dotnet run --project (Join-Path $runner 'Migrate.csproj') --no-build --no-launch-profile
    if ($LASTEXITCODE -ne 0) { throw 'Local migration failed.' }
    $retTestArguments = @((Join-Path $repo 'backend/tests/Juple.IntegrationTests/Juple.IntegrationTests.csproj'), '--no-restore', '--filter', $Filter, '-m:1')
    if ($Detailed) { $retTestArguments += @('--logger', 'console;verbosity=normal') }
    dotnet test @retTestArguments
    if ($LASTEXITCODE -ne 0) { throw 'RET integration tests failed.' }
} finally {
    $env:ConnectionStrings__JupleDatabase = $previousSql
    $env:ConnectionStrings__BlobStorage = $previousBlob
}
