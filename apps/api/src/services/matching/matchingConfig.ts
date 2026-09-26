export interface RedFlagRule {
  phrase: string;
  reason: string;
}

export interface MatchingConfiguration {
  explanationScoreThreshold: number; // Jobs scoring >= this threshold get LLM fit explanation
  defaultMinScore: number;
  redFlagPhrases: RedFlagRule[];
}

export const MATCHING_CONFIG: MatchingConfiguration = {
  // Score threshold for triggering grounded LLM fit explanation (Item 4)
  explanationScoreThreshold: parseInt(process.env.MATCHING_EXPLANATION_THRESHOLD || '60', 10),
  defaultMinScore: 40,

  // Screen description for mandatory face/video requirements as application preconditions (Item 3)
  // Kept strictly in config, NOT hardcoded in business logic.
  redFlagPhrases: [
    {
      phrase: 'submit a video introduction to be considered',
      reason: 'Mandatory video introduction required as application precondition',
    },
    {
      phrase: 'video introduction',
      reason: 'Precondition requires video introduction',
    },
    {
      phrase: 'video resume',
      reason: 'Precondition requires video resume',
    },
    {
      phrase: 'record a video interview',
      reason: 'Precondition requires recorded video interview',
    },
    {
      phrase: 'record a video',
      reason: 'Precondition requires video recording',
    },
    {
      phrase: 'selfie verification',
      reason: 'Mandatory selfie verification required',
    },
    {
      phrase: 'facial recognition',
      reason: 'Mandatory facial recognition screening',
    },
    {
      phrase: 'face recognition',
      reason: 'Mandatory face recognition screening',
    },
    {
      phrase: 'ai video screening',
      reason: 'Mandatory AI video screening precondition',
    },
    {
      phrase: 'ai video interview',
      reason: 'Mandatory AI video interview precondition',
    },
    {
      phrase: 'one-way video interview',
      reason: 'Mandatory asynchronous one-way video interview',
    },
    {
      phrase: 'asynchronous video interview',
      reason: 'Mandatory asynchronous video interview',
    },
  ],
};
