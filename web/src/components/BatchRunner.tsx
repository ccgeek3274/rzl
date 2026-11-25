import { useRef, useState } from 'react';
import { Alert, Button, Progress, Space } from 'antd';
import { apiErrorText } from '../lib/api';
import { useInvalidateAll } from '../lib/hooks';

type Step = { label: string; run: () => Promise<unknown> };

/**
 * Sequential long-running jobs (fetch N tournaments, enrich players) driven from the browser so each
 * Worker request stays short. Shows progress + errors, can be stopped.
 */
export function useBatch() {
  const [state, setState] = useState<{ title: string; done: number; total: number; current: string; errors: string[]; running: boolean } | null>(null);
  const stop = useRef(false);
  const invalidate = useInvalidateAll();

  async function run(title: string, steps: Step[]) {
    stop.current = false;
    const errors: string[] = [];
    setState({ title, done: 0, total: steps.length, current: steps[0]?.label ?? '', errors, running: true });
    for (let i = 0; i < steps.length; i++) {
      if (stop.current) break;
      setState((s) => s && { ...s, current: steps[i].label });
      try {
        await steps[i].run();
      } catch (e) {
        errors.push(`${steps[i].label}: ${apiErrorText(e) ?? 'chyba'}`);
      }
      setState((s) => s && { ...s, done: i + 1, errors: [...errors] });
    }
    setState((s) => s && { ...s, running: false, current: '' });
    invalidate();
  }

  /** Repeats `call` until it reports remaining = 0 (server-side batches). */
  async function loop(title: string, call: () => Promise<{ processed: number; remaining: number; errors: string[] }>) {
    stop.current = false;
    setState({ title, done: 0, total: 1, current: '', errors: [], running: true });
    let done = 0;
    const errors: string[] = [];
    for (let guard = 0; guard < 500 && !stop.current; guard++) {
      try {
        const r = await call();
        done += r.processed;
        errors.push(...r.errors);
        setState((s) => s && { ...s, done, total: done + r.remaining, errors: [...errors] });
        if (r.remaining === 0 || (r.processed === 0 && r.errors.length)) break;
      } catch (e) {
        errors.push(apiErrorText(e) ?? 'chyba');
        break;
      }
    }
    setState((s) => s && { ...s, running: false });
    invalidate();
  }

  const view = state && (
    <Alert
      style={{ marginBottom: 12 }}
      type={state.running ? 'info' : state.errors.length ? 'warning' : 'success'}
      title={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>
            {state.title}: {state.done} / {state.total} {state.current && <span className="muted">· {state.current}</span>}
          </span>
          {state.running ? (
            <Button size="small" onClick={() => (stop.current = true)}>
              Zastavit
            </Button>
          ) : (
            <Button size="small" onClick={() => setState(null)}>
              Zavřít
            </Button>
          )}
        </Space>
      }
      description={
        <>
          <Progress percent={state.total ? Math.round((state.done / state.total) * 100) : 0} size="small" status={state.running ? 'active' : undefined} />
          {state.errors.map((e, i) => (
            <div key={i} style={{ color: '#cf1322' }}>
              {e}
            </div>
          ))}
        </>
      }
    />
  );
  return { run, loop, view, running: !!state?.running };
}
