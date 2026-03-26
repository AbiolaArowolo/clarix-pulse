import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteState, isAlarmState } from '../lib/types';

export function useAlarm(sites: SiteState[]) {
  const [muted, setMuted] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const prevAlarmRef = useRef(false);

  const hasAlarm = sites.some((site) => site.instances.some(isAlarmState));

  // Auto-unmute on new alarm (if previously muted and alarm went away then came back)
  useEffect(() => {
    if (hasAlarm && !prevAlarmRef.current) {
      // New alarm event — unmute
      setMuted(false);
    }
    prevAlarmRef.current = hasAlarm;
    setAlarmActive(hasAlarm);
  }, [hasAlarm]);

  // Start/stop Web Audio alarm
  useEffect(() => {
    if (alarmActive && !muted) {
      startAlarm();
    } else {
      stopAlarm();
    }
    return () => stopAlarm();
  }, [alarmActive, muted]);

  function startAlarm() {
    if (oscillatorRef.current) return; // already running
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.connect(ctx.destination);
    gainRef.current = gain;

    // Two-tone alert: 880Hz and 660Hz alternating every 0.5s
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    // Alternate frequency
    let toggle = false;
    const interval = setInterval(() => {
      if (osc && ctx) {
        toggle = !toggle;
        osc.frequency.setValueAtTime(toggle ? 660 : 880, ctx.currentTime);
      }
    }, 500);

    osc.connect(gain);
    osc.start();
    oscillatorRef.current = osc;

    // Store interval cleanup on gain node (hack but works)
    (gain as any)._interval = interval;
  }

  function stopAlarm() {
    if (gainRef.current) {
      clearInterval((gainRef.current as any)._interval);
    }
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop(); } catch {}
      oscillatorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return { alarmActive, muted, toggleMute };
}
