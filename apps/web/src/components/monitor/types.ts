export type TaskStatus = "queue" | "investigating" | "review" | "done";

export type MonitorItem = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  source: string;
  status: string;
  note: string;
  processing: boolean;
  read: boolean;
  dismissed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MonitorComment = {
  id: string;
  monitorItemId: string;
  source: string;
  content: string;
  createdAt: Date;
};

export type Column = {
  id: TaskStatus;
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  dotColor: string;
};
