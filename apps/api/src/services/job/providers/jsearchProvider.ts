import { IJobSource, NormalizedJob } from '../types';

export interface JSearchRawJob {
  job_id?: string;
  employer_name?: string;
  job_title?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_description?: string | null;
  job_apply_link?: string | null;
  job_google_link?: string | null;
  job_posted_at_datetime_utc?: string | null;
  job_posted_at_timestamp?: number | null;
  [key: string]: any;
}

export class JSearchProvider implements IJobSource {
  public readonly name = 'jsearch';
  private apiKey: string;
  private fetcher: typeof fetch;

  constructor(apiKey?: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey || process.env.JSEARCH_API_KEY || process.env.RAPIDAPI_KEY || '';
    this.fetcher = fetcher;
  }

  async searchJobs(query: string, location?: string, page: number = 1): Promise<NormalizedJob[]> {
    if (!this.apiKey) {
      throw new Error('JSearch API key is missing (set JSEARCH_API_KEY or RAPIDAPI_KEY)');
    }

    const searchQuery = location && location.trim() ? `${query} in ${location}` : query;
    const url = new URL('https://jsearch.p.rapidapi.com/search-v2');
    url.searchParams.set('query', searchQuery);
    url.searchParams.set('page', String(page || 1));
    url.searchParams.set('num_pages', '1');

    const res = await this.fetcher(url.toString(), {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': this.apiKey,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const error: any = new Error(`JSearch API error: ${res.status} ${res.statusText} - ${errText}`);
      error.statusCode = res.status;
      throw error;
    }

    const data: any = await res.json();
    const rawJobs: JSearchRawJob[] = Array.isArray(data?.data?.jobs)
      ? data.data.jobs
      : Array.isArray(data?.data)
      ? data.data
      : [];

    return rawJobs.map((item) => {
      const locationParts = [item.job_city, item.job_state, item.job_country].filter(Boolean);
      const locStr = locationParts.length > 0 ? locationParts.join(', ') : null;

      let postedDate: string | null = null;
      if (item.job_posted_at_datetime_utc) {
        try {
          postedDate = new Date(item.job_posted_at_datetime_utc).toISOString();
        } catch {
          postedDate = null;
        }
      } else if (item.job_posted_at_timestamp) {
        try {
          postedDate = new Date(item.job_posted_at_timestamp * 1000).toISOString();
        } catch {
          postedDate = null;
        }
      }

      const salaryMin = typeof item.job_min_salary === 'number' && !isNaN(item.job_min_salary) ? item.job_min_salary : null;
      const salaryMax = typeof item.job_max_salary === 'number' && !isNaN(item.job_max_salary) ? item.job_max_salary : null;
      const salaryCurrency = (salaryMin !== null || salaryMax !== null) ? (item.job_salary_currency || 'USD') : null;

      return {
        externalId: String(item.job_id || item.job_google_link || Math.random().toString(36).substring(2)),
        sourceProvider: 'jsearch',
        title: String(item.job_title || '').trim(),
        company: String(item.employer_name || '').trim(),
        location: locStr,
        remote: Boolean(item.job_is_remote),
        salaryMin,
        salaryMax,
        salaryCurrency,
        description: item.job_description ? String(item.job_description) : null,
        applyUrl: item.job_apply_link || item.job_google_link || null,
        postedDate,
        fetchedAt: new Date().toISOString(),
      };
    });
  }
}
