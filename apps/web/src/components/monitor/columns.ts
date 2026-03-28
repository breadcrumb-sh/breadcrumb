import type { Column } from "./types";
import { QueueIcon, InvestigatingIcon, ReviewIcon, DoneIcon } from "./status-icons";

export const COLUMNS: Column[] = [
  {
    id: "queue",
    title: "Queue",
    description: "New detections and watch requests",
    icon: QueueIcon,
    dotColor: "text-zinc-400",
  },
  {
    id: "investigating",
    title: "Investigating",
    description: "Agent is analyzing traces",
    icon: InvestigatingIcon,
    dotColor: "text-amber-400",
  },
  {
    id: "review",
    title: "Needs Review",
    description: "Ready for developer review",
    icon: ReviewIcon,
    dotColor: "text-blue-400",
  },
  {
    id: "done",
    title: "Done",
    description: "Resolved or dismissed",
    icon: DoneIcon,
    dotColor: "text-violet-400",
  },
];

export function statusInfo(status: string) {
  const col = COLUMNS.find((c) => c.id === status);
  return {
    label: col?.title ?? status,
    dotColor: col?.dotColor ?? "text-zinc-400",
    Icon: col?.icon ?? QueueIcon,
  };
}

export function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
