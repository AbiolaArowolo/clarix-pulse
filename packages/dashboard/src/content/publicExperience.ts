export type PublicSolutionId = 'detect' | 'verify' | 'respond' | 'audit';

export interface PublicActivity {
  title: string;
  detail: string;
  metric: string;
  color: 'green' | 'yellow' | 'red' | 'orange';
  source: string;
}

export interface PublicSolution {
  id: PublicSolutionId;
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
  outcomes: string[];
  examples: string[];
  activity: PublicActivity[];
}

export const PUBLIC_SOLUTIONS: PublicSolution[] = [
  {
    id: 'detect',
    label: 'Detect',
    eyebrow: 'Find the invisible faster',
    title: 'Catch silent drift before it turns into downtime.',
    summary: 'Bring live signals, process checks, machine state, and log evidence into one place so the first warning does not come from a customer or downstream team.',
    outcomes: ['Earlier warning', 'Less blind time', 'Cleaner escalation'],
    examples: ['Process heartbeat stopped moving', 'Expected output went quiet', 'A recurring error returned after recovery'],
    activity: [
      {
        title: 'Continuity warning surfaced',
        detail: 'A monitored workflow missed its expected state change and triggered a watch alert.',
        metric: 'Detection: 18s',
        color: 'yellow',
        source: 'Signal + heartbeat checks',
      },
      {
        title: 'Hidden error pattern exposed',
        detail: 'Repeating log evidence crossed the threshold before the operator desk was flooded.',
        metric: 'Escalation: 42s',
        color: 'red',
        source: 'Log correlation',
      },
      {
        title: 'Redundant source remained healthy',
        detail: 'The alternate path stayed within tolerance while the primary source drifted.',
        metric: 'Fallback ready',
        color: 'green',
        source: 'Continuity monitoring',
      },
    ],
  },
  {
    id: 'verify',
    label: 'Verify',
    eyebrow: 'Confirm what changed',
    title: 'See what happened, where it started, and what it touched.',
    summary: 'Clarix Pulse helps teams verify incidents quickly by combining state, context, and evidence instead of forcing people to jump across separate tools.',
    outcomes: ['Faster triage', 'Clearer ownership', 'Lower guesswork'],
    examples: ['Which site was affected first?', 'Was the issue local or upstream?', 'Did recovery actually hold?'],
    activity: [
      {
        title: 'Incident correlated across sources',
        detail: 'The timeline linked a missed heartbeat with the exact evidence trail the team needed.',
        metric: 'Evidence grouped',
        color: 'orange',
        source: 'Timeline correlation',
      },
      {
        title: 'Recovered state confirmed',
        detail: 'Post-recovery checks stayed healthy long enough to close the incident confidently.',
        metric: 'Stable for 9m',
        color: 'green',
        source: 'Verification checks',
      },
      {
        title: 'Impact boundary isolated',
        detail: 'Operators could see the issue was contained to one monitored path instead of the whole operation.',
        metric: 'Scope narrowed',
        color: 'yellow',
        source: 'Live visibility',
      },
    ],
  },
  {
    id: 'respond',
    label: 'Respond',
    eyebrow: 'Move from alert to action',
    title: 'Cut response time when the operation needs a decision now.',
    summary: 'Create a shared operational picture so teams can acknowledge, act, and recover without wasting the first minutes of an incident.',
    outcomes: ['Faster acknowledgment', 'Less escalation friction', 'More resilient recovery'],
    examples: ['Dispatch a local team sooner', 'Confirm handoff between shifts', 'Escalate only when recovery fails'],
    activity: [
      {
        title: 'Escalation routed automatically',
        detail: 'The right responders were notified without waiting for manual interpretation.',
        metric: 'Ack: 54s',
        color: 'green',
        source: 'Alert routing',
      },
      {
        title: 'Manual intervention requested',
        detail: 'The workflow stayed degraded after the first recovery attempt and raised a higher-priority action.',
        metric: 'Priority raised',
        color: 'red',
        source: 'Recovery guardrail',
      },
      {
        title: 'Operator action logged',
        detail: 'Response history stayed attached to the incident so the next shift could continue cleanly.',
        metric: 'Audit trail live',
        color: 'orange',
        source: 'Response timeline',
      },
    ],
  },
  {
    id: 'audit',
    label: 'Audit',
    eyebrow: 'Prove continuity over time',
    title: 'Build a record of what happened and how your team handled it.',
    summary: 'Keep a visible timeline of incidents, recoveries, and repeated weak points so you can improve resilience instead of reliving the same outage.',
    outcomes: ['Better handoffs', 'Stronger reporting', 'Smarter improvements'],
    examples: ['Repeated drift across one site', 'Escalation delays by team or shift', 'Top recurring evidence sources'],
    activity: [
      {
        title: 'Recurring pattern identified',
        detail: 'Three related incidents shared the same weak signal path and moved into review.',
        metric: 'Pattern detected',
        color: 'orange',
        source: 'Historical trends',
      },
      {
        title: 'Response benchmark updated',
        detail: 'Average acknowledgment improved after the latest workflow change.',
        metric: '-31% response time',
        color: 'green',
        source: 'Ops reporting',
      },
      {
        title: 'Site review opened',
        detail: 'A repeated local issue now has enough evidence to justify a permanent fix.',
        metric: 'Evidence ready',
        color: 'yellow',
        source: 'Audit history',
      },
    ],
  },
];

export const LOGIN_ROTATOR = [
  'Pick up a live workspace, review what changed, and move straight into action.',
  'See current risk, recent activity, and the evidence behind each incident from one screen.',
  'Reconnect your team to the operation without losing the timeline of what already happened.',
];
