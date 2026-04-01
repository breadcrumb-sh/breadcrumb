/**
 * Event emitter for monitor real-time updates.
 * Used to push SSE events to connected clients via tRPC subscriptions.
 */

import EventEmitter from "events";

export type MonitorEvent = {
  projectId: string;
  itemId: string;
  type: "comment" | "status" | "processing";
};

export const monitorEvents = new EventEmitter();
monitorEvents.setMaxListeners(100);

export function emitMonitorEvent(event: MonitorEvent) {
  monitorEvents.emit(`project:${event.projectId}`, event);
}
