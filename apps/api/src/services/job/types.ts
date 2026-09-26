import { NormalizedJob } from '@job-agent/shared';

export { NormalizedJob };

export interface IJobSource {
  readonly name: string;
  searchJobs(query: string, location?: string, page?: number): Promise<NormalizedJob[]>;
}
