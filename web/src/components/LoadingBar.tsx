import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * Global activity indicator (best practice for SPAs): a thin indeterminate bar at the top of the page,
 * shown only after a short delay so fast requests don't flicker, plus the "progress" cursor
 * (the UI stays usable, so not the blocking "wait" cursor).
 */
export function LoadingBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, [busy]);
  useEffect(() => {
    document.documentElement.classList.toggle('is-busy', visible);
  }, [visible]);
  return <div className={`loading-bar${visible ? ' on' : ''}`} role="progressbar" aria-hidden={!visible} aria-label="Načítám" />;
}
