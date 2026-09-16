export type ProgressStageStatus = 'running' | 'completed' | 'waiting' | 'failed' | 'info';

export interface ProgressStage {
  id: string;
  kind?: 'runtime' | 'context' | 'tool' | 'artifact' | 'approval' | 'wait' | 'quota' | 'reasoning' | 'handoff' | 'capability' | 'workflow' | 'done' | 'info';
  status: ProgressStageStatus;
  title: string;
  detail?: string;
  meta?: string;
  action?: 'replay' | 'outputs' | 'recover' | 'retry' | 'relay';
  actionLabel?: string;
  updatedAt?: number;
}
