const developmentApiBaseUrl = 'http://localhost:5092';

export const apiConfig = {
  baseUrl: __DEV__ ? developmentApiBaseUrl : undefined,
};
