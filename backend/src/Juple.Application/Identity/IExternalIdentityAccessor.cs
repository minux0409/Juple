namespace Juple.Application.Identity;

public interface IExternalIdentityAccessor
{
    ExternalIdentityPrincipal GetRequired();
}