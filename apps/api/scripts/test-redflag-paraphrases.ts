import { screenJobDescription } from '../src/services/matching/redFlagFilter';
import { MATCHING_CONFIG, RedFlagRule } from '../src/services/matching/matchingConfig';

async function run() {
  console.log('========================================================================');
  console.log('🧪 REALISTIC PARAPHRASED RED-FLAG FILTER SCREENING EVALUATION');
  console.log('========================================================================\n');

  const testCases = [
    {
      id: 'case_1',
      description: 'Complete a one-way video interview via HireVue as the first step.',
      expectedIntent: 'Excluded (asynchronous one-way video hurdle)',
    },
    {
      id: 'case_2',
      description: 'Record a short video introducing yourself and upload it here.',
      expectedIntent: 'Excluded (mandatory video recording/introduction precondition)',
    },
    {
      id: 'case_3',
      description: 'Candidates must upload a selfie for identity verification before proceeding.',
      expectedIntent: 'Excluded (mandatory selfie verification hurdle)',
    },
    {
      id: 'control_1',
      description: 'Round 2 will be a 45-minute video call interview with the engineering manager.',
      expectedIntent: 'Allowed (legitimate 2-way live interview)',
    },
    {
      id: 'control_2',
      description: 'Final round consists of a video conference interview over Zoom with the lead architect.',
      expectedIntent: 'Allowed (legitimate 2-way live interview)',
    },
  ];

  console.log('📋 Testing 3 Realistic Paraphrased Precondition Hurdles + 2 Live Controls:\n');

  for (const tc of testCases) {
    const res = screenJobDescription(tc.description);
    const status = res.isExcluded ? '🔴 EXCLUDED' : '🟢 ALLOWED';
    console.log(`• [${tc.id}] "${tc.description}"`);
    console.log(`  Expected: ${tc.expectedIntent}`);
    console.log(`  Result:   ${status}`);
    if (res.isExcluded) {
      console.log(`  Reason:   "${res.excludedReason}" (Matched: "${res.matchedPhrase}")`);
    }
    console.log('');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
