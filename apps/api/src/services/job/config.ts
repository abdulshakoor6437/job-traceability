export interface ProviderQuotaConfig {
  monthlyLimit?: number;
  name: string;
  nearQuotaThresholdPercent: number;
}

export const JOB_SOURCING_CONFIG = {
  // Configurable shared cache TTL (starts at 8 hours)
  defaultCacheTtlHours: parseInt(process.env.JOB_CACHE_TTL_HOURS || '8', 10),

  // Free-tier limits must come strictly from real account dashboards.
  // No guessed/remembered numbers: if not explicitly configured in env, fail-closed (skip provider).
  providerQuotas: {
    jsearch: {
      // TODO: Configure exact free-tier limit directly from RapidAPI JSearch dashboard (e.g. JSEARCH_MONTHLY_LIMIT)
      monthlyLimit: process.env.JSEARCH_MONTHLY_LIMIT ? parseInt(process.env.JSEARCH_MONTHLY_LIMIT, 10) : undefined,
      name: 'JSearch (RapidAPI)',
      nearQuotaThresholdPercent: 90,
    },
    serpapi: {
      // TODO: Configure exact free-tier limit directly from SerpApi account dashboard (e.g. SERPAPI_MONTHLY_LIMIT)
      monthlyLimit: process.env.SERPAPI_MONTHLY_LIMIT ? parseInt(process.env.SERPAPI_MONTHLY_LIMIT, 10) : undefined,
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
