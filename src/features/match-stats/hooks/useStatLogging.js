import { useEffect, useState } from 'react';

export function useStatLogging({ matchId, stats }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [isPassModal, setIsPassModal] = useState(false);
  const [clickCoords, setClickCoords] = useState(null);
  const [passEndCoords, setPassEndCoords] = useState(null);
  const [editingStat, setEditingStat] = useState(null);
  const [lastReceiver, setLastReceiver] = useState({ kind: 'none' });
  const [playCounter, setPlayCounter] = useState(0);
  const [possessionCounter, setPossessionCounter] = useState(0);
  const [currentPossessionId, setCurrentPossessionId] = useState(0);
  const [currentPossessionTeamSide, setCurrentPossessionTeamSide] = useState('unknown');
  const [pendingNextPossessionTeamSide, setPendingNextPossessionTeamSide] = useState(null);

  useEffect(() => {
    if (!matchId) return;
    const maxPlay = Math.max(0, ...(stats || []).map((s) => Number(s?.play_id || 0)));
    const maxPoss = Math.max(0, ...(stats || []).map((s) => Number(s?.possession_id || 0)));
    setPlayCounter(maxPlay);
    setPossessionCounter(maxPoss);

    const ordered = [...(stats || [])].sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = Number(a?.normalized_time_s);
      const tb = Number(b?.normalized_time_s);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      const ra = Number(a?.time_s);
      const rb = Number(b?.time_s);
      if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
      const tsa = Date.parse(String(a?.timestamp || a?.created_date || ''));
      const tsb = Date.parse(String(b?.timestamp || b?.created_date || ''));
      if (Number.isFinite(tsa) && Number.isFinite(tsb) && tsa !== tsb) return tsa - tsb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const last = ordered.filter((s) => s?.stat_type !== 'substitution' && s?.stat_type !== 'period_end').slice(-1)[0] || ordered[ordered.length - 1];
    setCurrentPossessionId(Number(last?.possession_id || 0));
    setCurrentPossessionTeamSide(last?.possession_team_side || 'unknown');
    setPendingNextPossessionTeamSide(null);
  }, [matchId, stats]);

  const handlePointClick = (coords) => {
    setClickCoords(coords);
    setIsPassModal(false);
    setPassEndCoords(null);
    setModalOpen(true);
  };

  const handlePassDraw = (start, end) => {
    setClickCoords(start);
    setPassEndCoords(end);
    setIsPassModal(true);
    setModalOpen(true);
  };

  const openEditStat = (stat) => {
    if (!stat?.id) return;
    if (stat.stat_type === 'period_end' || stat.stat_type === 'substitution') return;
    if (stat.raw_x_position == null || stat.raw_y_position == null) return;
    setEditingStat(stat);
    setIsPassModal(!!stat.is_pass);
    setClickCoords({ x: stat.raw_x_position, y: stat.raw_y_position });
    if (stat.raw_end_x_position != null && stat.raw_end_y_position != null) {
      setPassEndCoords({ x: stat.raw_end_x_position, y: stat.raw_end_y_position });
    } else {
      setPassEndCoords(null);
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setClickCoords(null);
    setPassEndCoords(null);
    setEditingStat(null);
  };

  return {
    modalOpen,
    setModalOpen,
    isPassModal,
    setIsPassModal,
    clickCoords,
    setClickCoords,
    passEndCoords,
    setPassEndCoords,
    editingStat,
    setEditingStat,
    lastReceiver,
    setLastReceiver,
    playCounter,
    setPlayCounter,
    possessionCounter,
    setPossessionCounter,
    currentPossessionId,
    setCurrentPossessionId,
    currentPossessionTeamSide,
    setCurrentPossessionTeamSide,
    pendingNextPossessionTeamSide,
    setPendingNextPossessionTeamSide,
    handlePointClick,
    handlePassDraw,
    openEditStat,
    closeModal,
  };
}

export default useStatLogging;
