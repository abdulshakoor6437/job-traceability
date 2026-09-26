export interface ProviderQuotaConfig {
  monthlyLimit: number;
  name: string;
  nearQuotaThresholdPercent: number; // e.g. 90%
}

export const JOB_SOURCING_CONFIG = {
  // Configurable shared cache TTL (starts at 8 hours)
  defaultCacheTtlHours: parseInt(process.env.JOB_CACHE_TTL_HOURS || '8', 10),

  // Real free-tier limits documented from provider dashboards
  providerQuotas: {
    jsearch: {
      monthlyLimit: parseInt(process.env.JSEARCH_MONTHLY_LIMIT || '200', 10), // RapidAPI JSearch Basic Plan: 200 requests/mo
      name: 'JSearch (RapidAPI Basic)',
      nearQuotaThresholdPercent: 90,
    },
    serpapi: {
      monthlyLimit: parseInt(process.env.SERPAPI_MONTHLY_LIMIT || '250', 10), // SerpApi Free Plan: 250 searches/mo
      name: 'SerpApi (Google Jobs Free)',
      nearQuotaThresholdPercent: 90,
    },
    remotive: {
      monthlyLimit: Infinity, // Remotive is a free public API with no monthly account quota
      name: 'Remotive (Public API)',
      nearQuotaThresholdPercent: 100,
    },
  } as Record<string, ProviderQuotaConfig>,
};
