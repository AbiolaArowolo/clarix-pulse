import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteState, isAlarmState } from '../lib/types';

const ALARM_SOUND_ENABLED_KEY = 'pulse.alarm_sound_enabled';

type BrowserWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const browserWindow = window as BrowserWindow;
  const AudioContextCtor = globalThis.AudioContext ?? browserWindow.webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
}

export function useAlarm(sites: SiteState[]) {
  const [muted, setMuted] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(ALARM_SOUND_ENABLED_KEY) === '0';
    } catch {
      return false;
    }
  });
  const [alarmActive, setAlarmActive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const freqIntervalRef = useRef<number | null>(null);
  const vibrationTimerRef = useRef<number | null>(null);

  const hasAlarm = sites.some((site) => site.instances.some(isAlarmState));

  useEffect(() => {
    setAlarmActive(hasAlarm);
  }, [hasAlarm]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ALARM_SOUND_ENABLED_KEY, muted ? '0' : '1');
    } catch {
      // Ignore storage failures.
    }
  }, [muted]);

  useEffect(() => {
    if (alarmActive && !muted) {
      startAlarm();
      startVibration();
    } else {
      stopAlarm();
      stopVibration();
    }

    return () => {
      stopAlarm();
      stopVibration();
    };
  }, [alarmActive, muted]);

  function startAlarm() {
    if (oscillatorRef.current) return;

    const ctx = createAudioContext();
    if (!ctx) return;

    audioCtxRef.current = ctx;
    void ctx.resume().catch(() => {});

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.connect(ctx.destination);
    gainRef.current = gain;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    let toggle = false;
    const interval = window.setInterval(() => {
      toggle = !toggle;
      osc.frequency.setValueAtTime(toggle ? 660 : 880, ctx.currentTime);
    }, 500);

    osc.connect(gain);
    osc.start();
    oscillatorRef.current = osc;
    freqIntervalRef.current = interval;
  }

  function stopAlarm() {
    if (freqIntervalRef.current !== null) {
      window.clearInterval(freqIntervalRef.current);
      freqIntervalRef.current = null;
    }

    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
      } catch {
        // Ignore stop errors from already-closed contexts.
      }
      oscillatorRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  function startVibration() {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (vibrationTimerRef.current !== null) return;

    const pulse = () => navigator.vibrate([250, 150, 250, 700]);
    pulse();
    vibrationTimerRef.current = window.setInterval(pulse, 2500);
  }

  function stopVibration() {
    if (vibrationTimerRef.current !== null) {
      window.clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  }

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  return { alarmActive, muted, toggleMute };
}
