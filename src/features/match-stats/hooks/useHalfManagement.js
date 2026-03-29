import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function useHalfManagement({ db, match, halfStartByHalf, initialHalf = 'first' }) {
  const [half, setHalf] = useState(initialHalf);
  const [directionByPeriod, setDirectionByPeriod] = useState(null);
  const [halfPrompt, setHalfPrompt] = useState({ open: false, nextHalf: null });
  const [endPeriodPrompt, setEndPeriodPrompt] = useState({ open: false, nextHalf: null });
  const [nextHalfReminder, setNextHalfReminder] = useState({ open: false, nextHalf: null });

  useEffect(() => {
    if (!match?.id) return;
    const fallback = { first: 'right', second: 'left', et_first: 'right', et_second: 'left' };
    let next = null;
    const raw = match.direction_by_period;
    if (raw && typeof raw === 'string') {
      try { next = JSON.parse(raw); } catch { next = null; }
    } else if (raw && typeof raw === 'object') {
      next = raw;
    }
    const merged = { ...fallback, ...(next || {}) };
    setDirectionByPeriod(merged);
    if (!raw) {
      db.entities.Match.update(match.id, { direction_by_period: JSON.stringify(merged) }).catch(() => {});
    }
  }, [db, match?.id, match?.direction_by_period]);

  const getDirForHalf = (h) => (directionByPeriod && directionByPeriod[h]) ? directionByPeriod[h] : 'right';

  const persistDirectionByPeriod = async (next) => {
    setDirectionByPeriod(next);
    if (!match?.id) return;
    try {
      await db.entities.Match.update(match.id, { direction_by_period: JSON.stringify(next) });
    } catch {
      // ignore
    }
  };

  const flipDirectionForHalf = async (h) => {
    const cur = getDirForHalf(h);
    const nextDir = cur === 'left' ? 'right' : 'left';
    const next = { ...(directionByPeriod || {}), [h]: nextDir };
    await persistDirectionByPeriod(next);
  };

  const requestHalfChange = (nextHalf) => {
    if (!nextHalf || nextHalf === half) return;
    setHalfPrompt({ open: true, nextHalf });
  };

  const openEndHalfPrompt = () => {
    const nextMap = { first: 'second', second: 'et_first', et_first: 'et_second', et_second: null };
    const nextHalf = nextMap[half] || null;
    if (!nextHalf) {
      toast.message('No next period');
      return;
    }
    setEndPeriodPrompt({ open: true, nextHalf });
  };

  const remindNextHalfStart = (nextHalf) => {
    if (!nextHalf) return;
    const nextAnchor = Number(halfStartByHalf?.[nextHalf]);
    if (Number.isFinite(nextAnchor)) return;
    setNextHalfReminder({ open: true, nextHalf });
  };

  return {
    half,
    setHalf,
    directionByPeriod,
    halfPrompt,
    setHalfPrompt,
    endPeriodPrompt,
    setEndPeriodPrompt,
    nextHalfReminder,
    setNextHalfReminder,
    getDirForHalf,
    persistDirectionByPeriod,
    flipDirectionForHalf,
    requestHalfChange,
    openEndHalfPrompt,
    remindNextHalfStart,
  };
}

export default useHalfManagement;
