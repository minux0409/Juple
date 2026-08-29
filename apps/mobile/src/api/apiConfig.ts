const developmentApiBaseUrl = 'http://10.0.2.2:5092';

export const apiConfig = {
  baseUrl: __DEV__ ? developmentApiBaseUrl : undefined,
};
