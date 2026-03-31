/**
 * Shared types for monitor agent evals.
 */

export interface MonitorEvalOutcome {
  queriesRun: string[];
  ticketsCreated: Array<{ title: string; description: string }>;
  memoryWrites: string[];
  memoryUpdates: Array<{ oldStr: string; newStr: string }>;
  commentsAdded: string[];
  statusSet: string | null;
  prioritySet: string | null;
  labelsSet: string[];
  traceNamesSet: string[];
  followupsScheduled: Array<{ delayMinutes: number; reason: string }>;
  noteWrites: string[];
  noteUpdates: Array<{ oldStr: string; newStr: string }>;
}

export function emptyOutcome(): MonitorEvalOutcome {
  return {
    queriesRun: [],
    ticketsCreated: [],
    memoryWrites: [],
    memoryUpdates: [],
    commentsAdded: [],
    statusSet: null,
    prioritySet: null,
    labelsSet: [],
    traceNamesSet: [],
    followupsScheduled: [],
    noteWrites: [],
    noteUpdates: [],
  };
}

export interface ScanFixture {
  name: string;
  description: string;
  projectMemory: string;
  queryResponses: Record<string, unknown[]>;
  expected: {
    shouldCreateTickets: boolean;
    ticketCount?: [number, number];
    shouldUpdateMemory: boolean;
    ticketTitleKeywords?: string[];
  };
}

export interface InvestigateFixture {
  name: string;
  description: string;
  item: { title: string; description: string; status: string; note: string };
  projectMemory: string;
  comments: Array<{ source: "user" | "agent"; content: string }>;
  availableLabels: string[];
  queryResponses: Record<string, unknown[]>;
  expected: {
    /** Weighted verdict map — keys are acceptable statuses, values are scores (0-1). */
    verdicts: Partial<Record<"review" | "done" | "followup", number>>;
    shouldComment: boolean;
    expectedPriority?: string;
    expectedLabels?: string[];
    commentKeywords?: string[];
  };
}
