export interface ProviderQuotaConfig {
  monthlyLimit?: number;
  name: string;
  nearQuotaThresholdPercent: number;
}

export const JOB_SOURCING_CONFIG = {
  // Configurable shared cache TTL (starts at 8 hours)
  defaultCacheTtlHours: parseInt(process.env.JOB_CACHE_TTL_HOURS || '8', 10),

  // Real dashboard quota numbers confirmed directly:
  // - JSearch: 100 requests/month (hard cap)
  // - SerpApi: 250 searches/month (2 already used this cycle, 248 remaining)
  // - Remotive: no limit (public API)
  providerQuotas: {
    jsearch: {
      monthlyLimit: process.env.JSEARCH_MONTHLY_LIMIT ? parseInt(process.env.JSEARCH_MONTHLY_LIMIT, 10) : 100,
      name: 'JSearch (RapidAPI)',
      nearQuotaThresholdPercent: 90,
    },
    serpapi: {
      monthlyLimit: process.env.SERPAPI_MONTHLY_LIMIT ? parseInt(process.env.SERPAPI_MONTHLY_LIMIT, 10) : 250,
      name: 'SerpApi (Google Jobs)',
      nearQuotaThresholdPercent: 90,
    },
    remotive: {
      // Remotive is a public open-access API with no account registration or monthly limit
      monthlyLimit: Infinity,
      name: 'Remotive (Public API)',
      nearQuotaThresholdPercent: 100,
    },
  } as Record<string, ProviderQuotaConfig>,
};
