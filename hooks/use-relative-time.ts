import { useEffect, useState } from 'react';

/**
 * Re-runs `formatter(iso)` every minute so relative timestamps like
 * "2m ago" stay fresh while a screen is mounted.
 *
 * The formatter should be a stable module-level function (or wrapped in
 * useCallback); changing it will re-seed the value.
 */
export function useRelativeTime(
  iso: string,
  formatter: (iso: string) => string,
): string {
  const [value, setValue] = useState(() => formatter(iso));

  useEffect(() => {
    setValue(formatter(iso));
    const id = setInterval(() => setValue(formatter(iso)), 60_000);
    return () => clearInterval(id);
  }, [iso, formatter]);

  return value;
}
