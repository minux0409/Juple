import {
  buildProductionEntraAuthConfig,
  entraDevAuthConfig,
  resolveEntraAuthConfig,
} from '../entraAuthConfig';

const fakeProductionEntraEnv = {
  instance: 'https://jupleprod.ciamlogin.com/',
  tenantId: '11111111-1111-1111-1111-111111111111',
  apiClientId: '22222222-2222-2222-2222-222222222222',
  nativeClientId: '33333333-3333-3333-3333-333333333333',
};

describe('resolveEntraAuthConfig', () => {
  it('selects the Development config for a Debug build (__DEV__ true)', () => {
    const config = resolveEntraAuthConfig({
      isDev: true,
      apiEnv: undefined,
      productionEntraEnv: {},
    });

    expect(config).toBe(entraDevAuthConfig);
  });

  it('selects the Development config for a Dogfood build', () => {
    const config = resolveEntraAuthConfig({
      isDev: false,
      apiEnv: 'dogfood',
      productionEntraEnv: {},
    });

    expect(config).toBe(entraDevAuthConfig);
  });

  it('builds the Production config for a Production build with all required values set', () => {
    const config = resolveEntraAuthConfig({
      isDev: false,
      apiEnv: 'production',
      productionEntraEnv: fakeProductionEntraEnv,
    });

    expect(config.clientId).toBe(fakeProductionEntraEnv.nativeClientId);
    expect(config.issuer).toContain(fakeProductionEntraEnv.tenantId);
    expect(config.authorizationEndpoint).toBe(
      'https://jupleprod.ciamlogin.com/11111111-1111-1111-1111-111111111111/oauth2/v2.0/authorize',
    );
    expect(config.scopes).toContain(
      `api://${fakeProductionEntraEnv.apiClientId}/access_as_user`,
    );
  });

  it('never falls back to the Development tenant/client for a Production build', () => {
    const config = resolveEntraAuthConfig({
      isDev: false,
      apiEnv: 'production',
      productionEntraEnv: fakeProductionEntraEnv,
    });

    expect(config.clientId).not.toBe(entraDevAuthConfig.clientId);
    expect(config.issuer).not.toBe(entraDevAuthConfig.issuer);
    expect(config.scopes).not.toEqual(entraDevAuthConfig.scopes);
  });

  it('reuses the same redirect URI across Development and Production', () => {
    const productionConfig = resolveEntraAuthConfig({
      isDev: false,
      apiEnv: 'production',
      productionEntraEnv: fakeProductionEntraEnv,
    });

    expect(productionConfig.redirectUrl).toBe(entraDevAuthConfig.redirectUrl);
    expect(entraDevAuthConfig.redirectUrl).toBe(
      'com.juple.app.auth://oauthredirect',
    );
  });

  it('throws (fail-closed) for a Production build missing any required value, naming only the missing ones', () => {
    expect(() =>
      resolveEntraAuthConfig({
        isDev: false,
        apiEnv: 'production',
        productionEntraEnv: {
          instance: fakeProductionEntraEnv.instance,
          tenantId: fakeProductionEntraEnv.tenantId,
          // apiClientId and nativeClientId intentionally omitted.
        },
      }),
    ).toThrow(/JUPLE_ENTRA_PROD_API_CLIENT_ID.*JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID/s);
  });

  it('throws for a Production build missing every required value', () => {
    expect(() =>
      resolveEntraAuthConfig({
        isDev: false,
        apiEnv: 'production',
        productionEntraEnv: {},
      }),
    ).toThrow(
      /JUPLE_ENTRA_PROD_INSTANCE.*JUPLE_ENTRA_PROD_TENANT_ID.*JUPLE_ENTRA_PROD_API_CLIENT_ID.*JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID/s,
    );
  });

  it('throws for an unrecognized/unset environment rather than guessing a tenant', () => {
    expect(() =>
      resolveEntraAuthConfig({
        isDev: false,
        apiEnv: undefined,
        productionEntraEnv: {},
      }),
    ).toThrow();
  });
});

describe('buildProductionEntraAuthConfig', () => {
  it('never returns a config equal to the Development config, even by accident', () => {
    const config = buildProductionEntraAuthConfig(fakeProductionEntraEnv);

    expect(config).not.toEqual(entraDevAuthConfig);
  });
});
