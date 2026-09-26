import { IJobSource, NormalizedJob } from '../types';

export interface RemotiveRawJob {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  company_logo?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  [key: string]: any;
}

export class RemotiveProvider implements IJobSource {
  public readonly name = 'remotive';
  private fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async searchJobs(query: string, _location?: string, _page: number = 1): Promise<NormalizedJob[]> {
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (query && query.trim()) {
      url.searchParams.set('search', query.trim());
    }

    const res = await this.fetcher(url.toString(), {
      method: 'GET',
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const error: any = new Error(`Remotive API error: ${res.status} ${res.statusText} - ${errText}`);
      error.statusCode = res.status;
      throw error;
    }

    const data: any = await res.json();
    const rawJobs: RemotiveRawJob[] = Array.isArray(data?.jobs) ? data.jobs : [];

    return rawJobs.map((item) => {
      // Missing fields (e.g. Remotive has no structured salary data or empty string)
      // must be null, NEVER fabricated or estimated.
      const salaryMin: number | null = null;
      const salaryMax: number | null = null;
      const salaryCurrency: string | null = null;

      let postedDate: string | null = null;
      if (item.publication_date) {
        try {
          postedDate = new Date(item.publication_date).toISOString();
        } catch {
          postedDate = null;
        }
      }

      return {
        externalId: String(item.id || item.url || Math.random().toString(36).substring(2)),
        sourceProvider: 'remotive',
        title: String(item.title || '').trim(),
        company: String(item.company_name || '').trim(),
        location: item.candidate_required_location ? String(item.candidate_required_location).trim() : 'Remote',
        remote: true, // All Remotive jobs are remote
        salaryMin,
        salaryMax,
        salaryCurrency,
        description: item.description ? String(item.description) : null,
        applyUrl: item.url || null,
        postedDate,
        fetchedAt: new Date().toISOString(),
      };
    });
  }
}
