import type { Delta, IcalEvent, TaskRow } from './types';

export function computeDelta(events: IcalEvent[], existing: Map<string, TaskRow>): Delta {
  const created: IcalEvent[] = [];
  const modified: IcalEvent[] = [];
  const unchanged: IcalEvent[] = [];

  for (const ev of events) {
    const prev = existing.get(ev.uid);
    if (!prev) {
      created.push(ev);
      continue;
    }
    const prevLm = prev.last_modified ? new Date(prev.last_modified).getTime() : 0;
    const curLm = ev.lastModified ? ev.lastModified.getTime() : 0;
    const summaryChanged = prev.summary !== ev.summary;
    const dueChanged = (prev.due ?? null) !== (ev.due ? ev.due.toISOString() : null);
    if (curLm > prevLm || summaryChanged || dueChanged) modified.push(ev);
    else unchanged.push(ev);
  }
  return { created, modified, unchanged };
}
