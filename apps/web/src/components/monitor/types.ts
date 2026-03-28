export type TaskStatus = "queue" | "investigating" | "review" | "done";

export type MonitorItem = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  dismissed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Column = {
  id: TaskStatus;
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  dotColor: string;
};
