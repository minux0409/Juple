# Build context is backend/ (the solution root), not this directory - COPY paths below are
# relative to backend/ so the multi-project ProjectReference graph (Api -> Application,
# Infrastructure -> Application, Domain) is reachable. Build with:
#   docker build -f src/Juple.Api/Dockerfile -t juple-api .
# from the backend/ directory (or `docker build -f backend/src/Juple.Api/Dockerfile backend/`
# from the repo root).

# Pinned to the exact SDK version in backend/global.json (rollForward: latestPatch only rolls
# forward within the same feature band - e.g. it will not move from 10.0.302 to 10.0.4xx - so
# the floating `10.0` tag is not guaranteed to satisfy it, and did not on the version available
# at the time this Dockerfile was written). Bump this tag whenever global.json's SDK version
# changes to a different feature band.
FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /src

# global.json pins the SDK version (rollForward: latestPatch) - copying it into the build
# context makes the container build fail loudly on an incompatible SDK image instead of
# silently building against a different toolchain than local dev. Directory.Build.props and
# Directory.Packages.props must also be present before any `dotnet restore` - the solution uses
# NuGet Central Package Management (ManagePackageVersionsCentrally), so every PackageReference
# below relies on Directory.Packages.props for its actual version.
COPY global.json Directory.Build.props Directory.Packages.props ./

# Project files only, so `dotnet restore` gets its own Docker layer that is only invalidated
# when a .csproj actually changes - not on every source edit.
COPY src/Juple.Domain/Juple.Domain.csproj src/Juple.Domain/
COPY src/Juple.Application/Juple.Application.csproj src/Juple.Application/
COPY src/Juple.Infrastructure/Juple.Infrastructure.csproj src/Juple.Infrastructure/
COPY src/Juple.Api/Juple.Api.csproj src/Juple.Api/
RUN dotnet restore src/Juple.Api/Juple.Api.csproj

# Full source last, so edits here don't invalidate the restore layer above. tests/ is
# intentionally never copied - the runtime image has no use for it.
COPY src/ src/

# UseAppHost=false skips generating the native apphost executable, which the image never
# uses (ENTRYPOINT invokes the published Juple.Api.dll via the runtime image's `dotnet` host)
# - one less unnecessary artifact in the publish output.
RUN dotnet publish src/Juple.Api/Juple.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

# ASP.NET Core runtime only - no SDK, no compilers, no NuGet caches.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# .NET 10's recommended container port binding - simpler than ASPNETCORE_URLS for the common
# case of listening on one plain HTTP port. Container Apps ingress terminates TLS in front of
# this container, so the app itself only ever needs to speak HTTP.
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

# No ASPNETCORE_ENVIRONMENT is set here on purpose - this image must not be tied to any one
# environment (Development/AzureDevelopment/Production all run this same image). It is always
# supplied externally (docker run -e / Container Apps env var) at deploy time. Likewise, no
# connection string, Blob URL, or Entra setting is ever baked in here - all runtime
# configuration continues to flow through the existing ASP.NET Core configuration/env var
# structure (see appsettings.json, DependencyInjection.cs, BlobServiceClientFactory.cs).
COPY --from=build /app/publish .

# The official aspnet image already defines a non-root "app" user (APP_UID) - switching to it
# here is the standard way to avoid running as root, with no extra user-creation step needed.
USER $APP_UID

ENTRYPOINT ["dotnet", "Juple.Api.dll"]
