import { IJobSource, NormalizedJob } from '../types';

export interface SerpApiRawJob {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  job_id?: string;
  share_link?: string;
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    work_from_home?: boolean;
    salary?: string;
    [key: string]: any;
  };
  apply_options?: Array<{ title?: string; link?: string }>;
  related_links?: Array<{ link?: string }>;
  [key: string]: any;
}

export class SerpApiProvider implements IJobSource {
  public readonly name = 'serpapi';
  private apiKey: string;
  private fetcher: typeof fetch;

  constructor(apiKey?: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey || process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || '';
    this.fetcher = fetcher;
  }

  async searchJobs(query: string, location?: string, page: number = 1): Promise<NormalizedJob[]> {
    if (!this.apiKey) {
      throw new Error('SerpAPI key is missing (set SERPAPI_KEY or SERPAPI_API_KEY)');
    }

    const searchQuery = location && location.trim() ? `${query} in ${location}` : query;
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_jobs');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('api_key', this.apiKey);

    const start = Math.max(0, ((page || 1) - 1) * 10);
    if (start > 0) {
      url.searchParams.set('start', String(start));
    }

    const res = await this.fetcher(url.toString(), {
      method: 'GET',
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const error: any = new Error(`SerpAPI error: ${res.status} ${res.statusText} - ${errText}`);
      error.statusCode = res.status;
      throw error;
    }

    const data: any = await res.json();
    const rawJobs: SerpApiRawJob[] = Array.isArray(data?.jobs_results) ? data.jobs_results : [];

    return rawJobs.map((item) => {
      const isRemote = Boolean(
        item.detected_extensions?.work_from_home ||
        (item.location && /remote/i.test(item.location)) ||
        (item.description && /\bremote\b/i.test(item.description))
      );

      const { salaryMin, salaryMax, salaryCurrency } = this.parseSalary(item.detected_extensions?.salary);

      const applyUrl = item.apply_options?.[0]?.link ||
        item.share_link ||
        item.related_links?.[0]?.link ||
        null;

      return {
        externalId: String(item.job_id || item.share_link || Math.random().toString(36).substring(2)),
        sourceProvider: 'serpapi',
        title: String(item.title || '').trim(),
        company: String(item.company_name || '').trim(),
        location: item.location ? String(item.location).trim() : null,
        remote: isRemote,
        salaryMin,
        salaryMax,
        salaryCurrency,
        description: item.description ? String(item.description) : null,
        applyUrl,
        postedDate: item.detected_extensions?.posted_at ? this.parseRelativeDate(item.detected_extensions.posted_at) : null,
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  private parseSalary(salaryStr?: string): { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null } {
    if (!salaryStr || typeof salaryStr !== 'string') {
      return { salaryMin: null, salaryMax: null, salaryCurrency: null };
    }

    // Try extracting clean range e.g. "$70,000–$90,000" or "$150K–$180K" or "£40,000"
    const cleaned = salaryStr.replace(/,/g, '').trim();
    let currency: string | null = null;
    if (cleaned.includes('$')) currency = 'USD';
    else if (cleaned.includes('£')) currency = 'GBP';
    else if (cleaned.includes('€')) currency = 'EUR';

    const numbers = cleaned.match(/(\d+(?:\.\d+)?)\s*(k|K)?/g);
    if (!numbers || numbers.length === 0) {
      return { salaryMin: null, salaryMax: null, salaryCurrency: null };
    }

    const parseNum = (str: string): number => {
      const isK = /[kK]/.test(str);
      const val = parseFloat(str.replace(/[^\d.]/g, ''));
      return isK ? val * 1000 : val;
    };

    const parsedValues = numbers.map(parseNum).filter((v) => !isNaN(v) && v > 0);
    if (parsedValues.length === 0) {
      return { salaryMin: null, salaryMax: null, salaryCurrency: null };
    }

    if (parsedValues.length === 1) {
      return { salaryMin: parsedValues[0], salaryMax: parsedValues[0], salaryCurrency: currency || 'USD' };
    }

    return {
      salaryMin: Math.min(parsedValues[0], parsedValues[1]),
      salaryMax: Math.max(parsedValues[0], parsedValues[1]),
      salaryCurrency: currency || 'USD',
    };
  }

  private parseRelativeDate(postedAtStr: string): string | null {
    const now = Date.now();
    const str = postedAtStr.toLowerCase();
    const match = str.match(/(\d+)\s+(day|hour|minute|week|month)/);
    if (!match) return null;

    const count = parseInt(match[1], 10);
    const unit = match[2];
    let ms = 0;
    if (unit === 'minute') ms = count * 60 * 1000;
    else if (unit === 'hour') ms = count * 60 * 60 * 1000;
    else if (unit === 'day') ms = count * 24 * 60 * 60 * 1000;
    else if (unit === 'week') ms = count * 7 * 24 * 60 * 60 * 1000;
    else if (unit === 'month') ms = count * 30 * 24 * 60 * 60 * 1000;

    return new Date(now - ms).toISOString();
  }
}
