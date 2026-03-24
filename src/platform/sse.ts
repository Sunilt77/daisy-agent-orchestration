import type { Response } from 'express';

type Subscriber = { res: Response };

const subscribersByRunId = new Map<string, Set<Subscriber>>();

export function sseSubscribe(runId: string, res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sub: Subscriber = { res };
  let set = subscribersByRunId.get(runId);
  if (!set) {
    set = new Set();
    subscribersByRunId.set(runId, set);
  }
  set.add(sub);

  // Heartbeat to keep connections alive through proxies.
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {}\n\n`);
    } catch {
      /* ignore */
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeat);
    set?.delete(sub);
    if (set && set.size === 0) subscribersByRunId.delete(runId);
  });
}

export function ssePublish(runId: string, eventName: string, payload: unknown) {
  const set = subscribersByRunId.get(runId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const sub of set) {
    try {
      sub.res.write(`event: ${eventName}\ndata: ${data}\n\n`);
    } catch {
      // client disconnected
    }
  }
}

