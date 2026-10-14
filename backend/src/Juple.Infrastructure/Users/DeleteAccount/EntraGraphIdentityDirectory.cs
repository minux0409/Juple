using System.Net;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Juple.Application.Identity;
using Juple.Application.Users.DeleteAccount;

namespace Juple.Infrastructure.Users.DeleteAccount;

/// <summary>
/// Microsoft Graph access to the External ID (customer) tenant: read one user's sign-in email, delete one user.
///
/// Authentication: an app registration in the customer tenant holds the Graph application permission (User.ReadWrite.All - the
/// least privilege Microsoft documents for "Delete a user"). The API's user-assigned managed identity lives in a different tenant
/// (the Azure subscription's), so it cannot hold Graph roles itself. The API proves to be the app registration with its client
/// secret (a Container Apps secret); alternatively, where Entra accepts it, the managed identity vouches for the app through a
/// federated identity credential (ClientAssertionCredential) and no secret exists.
///
/// Only the identity passed in is ever read or deleted, and only when it belongs to the configured tenant; the id in the answer is
/// checked against it. Deleting is Graph's soft delete (30 days in the tenant's deleted items): the account can no longer sign in.
/// </summary>
public sealed class EntraGraphIdentityDirectory : IEntraIdentityDirectory
{
    private static readonly string[] GraphScope = ["https://graph.microsoft.com/.default"];
    private const string TokenExchangeScope = "api://AzureADTokenExchange/.default";

    private readonly HttpClient _http;
    private readonly TokenCredential _credential;
    private readonly EntraAccountDeletionOptions _options;

    public EntraGraphIdentityDirectory(HttpClient http, EntraAccountDeletionOptions options, TokenCredential? credential = null)
    {
        _http = http;
        _options = options;
        _credential = credential ?? CreateFederatedCredential(options);
    }

    public static TokenCredential CreateFederatedCredential(EntraAccountDeletionOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.ClientSecret))
        {
            return new ClientSecretCredential(options.TenantId.ToString("D"), options.ClientId, options.ClientSecret);
        }

        var managedIdentity = new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(options.ManagedIdentityClientId));
        return new ClientAssertionCredential(
            options.TenantId.ToString("D"),
            options.ClientId,
            async cancellationToken => (await managedIdentity.GetTokenAsync(new TokenRequestContext([TokenExchangeScope]), cancellationToken)).Token);
    }

    public async Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default)
    {
        if (!IsConfiguredTenant(identity))
        {
            return null;
        }

        try
        {
            using var request = await CreateRequestAsync(HttpMethod.Get, identity, "?$select=id,mail,identities", cancellationToken);
            using var response = await _http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            var root = document.RootElement;
            if (!root.TryGetProperty("id", out var id) || !Guid.TryParse(id.GetString(), out var answeredId) || answeredId != identity.ObjectId)
            {
                return null;
            }

            if (root.TryGetProperty("identities", out var identities) && identities.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in identities.EnumerateArray())
                {
                    if (entry.TryGetProperty("signInType", out var type) && type.GetString() == "emailAddress"
                        && entry.TryGetProperty("issuerAssignedId", out var address) && !string.IsNullOrWhiteSpace(address.GetString()))
                    {
                        return address.GetString();
                    }
                }
            }

            return root.TryGetProperty("mail", out var mail) && !string.IsNullOrWhiteSpace(mail.GetString()) ? mail.GetString() : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or AuthenticationFailedException or CredentialUnavailableException or TaskCanceledException)
        {
            return null;
        }
    }

    public async Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default)
    {
        if (!IsConfiguredTenant(identity))
        {
            // Never touch a user of a tenant we were not configured for; permanent failure the operator can see.
            throw new EntraDirectoryException("tenant_mismatch");
        }

        try
        {
            using var request = await CreateRequestAsync(HttpMethod.Delete, identity, string.Empty, cancellationToken);
            using var response = await _http.SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return EntraIdentityDeletionOutcome.AlreadyGone;
            }

            if (response.IsSuccessStatusCode)
            {
                return EntraIdentityDeletionOutcome.Deleted;
            }

            throw new EntraDirectoryException("http_" + (int)response.StatusCode);
        }
        catch (Exception exception) when (exception is HttpRequestException or AuthenticationFailedException or CredentialUnavailableException or TaskCanceledException)
        {
            throw new EntraDirectoryException(SanitizedCodeOf(exception));
        }
    }

    /// <summary>
    /// The exception type, plus the Entra error number (AADSTS#####) when the message carries one - the one detail an operator needs
    /// to tell a wrong federated credential from a missing permission. Nothing else of the message is ever kept.
    /// </summary>
    internal static string SanitizedCodeOf(Exception exception)
    {
        var match = System.Text.RegularExpressions.Regex.Match(exception.ToString(), @"AADSTS\d{4,7}");
        return match.Success ? exception.GetType().Name + "_" + match.Value : exception.GetType().Name;
    }

    private bool IsConfiguredTenant(ExternalIdentityPrincipal identity) =>
        _options.Enabled && identity.TenantId == _options.TenantId && identity.ObjectId != Guid.Empty;

    private async Task<HttpRequestMessage> CreateRequestAsync(HttpMethod method, ExternalIdentityPrincipal identity, string query, CancellationToken cancellationToken)
    {
        var token = await _credential.GetTokenAsync(new TokenRequestContext(GraphScope), cancellationToken);
        var request = new HttpRequestMessage(method, $"https://graph.microsoft.com/v1.0/users/{identity.ObjectId:D}{query}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.Token);
        return request;
    }
}

/// <summary>Used while <see cref="EntraAccountDeletionOptions.Enabled"/> is false: nothing is asked of any directory.</summary>
public sealed class DisabledEntraIdentityDirectory : IEntraIdentityDirectory
{
    public Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) => Task.FromResult<string?>(null);

    public Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
        throw new EntraDirectoryException("disabled");
}
