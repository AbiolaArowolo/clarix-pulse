import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteState, isAlarmState } from '../lib/types';

const ALARM_SOUND_ENABLED_KEY = 'pulse.alarm_sound_enabled';
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

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
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const freqIntervalRef = useRef<number | null>(null);
  const vibrationTimerRef = useRef<number | null>(null);
  const interactionUnlockedRef = useRef(false);

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

  const ensureAudioContext = useCallback(() => {
    const existing = audioCtxRef.current;
    if (existing && existing.state !== 'closed') {
      return existing;
    }

    const ctx = createAudioContext();
    if (!ctx) return null;

    audioCtxRef.current = ctx;
    return ctx;
  }, []);

  const unlockAudio = useCallback(async () => {
    const ctx = ensureAudioContext();
    if (!ctx) return false;

    try {
      if (ctx.state !== 'running') {
        await ctx.resume();
      }
    } catch {
      // Ignore resume failures and report blocked state below.
    }

    const running = ctx.state === 'running';
    setAudioBlocked(!running);
    return running;
  }, [ensureAudioContext]);

  const stopAlarm = useCallback(() => {
    if (freqIntervalRef.current !== null) {
      window.clearInterval(freqIntervalRef.current);
      freqIntervalRef.current = null;
    }

    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
      } catch {
        // Ignore stop errors from already-stopped oscillators.
      }
      oscillatorRef.current.disconnect();
      oscillatorRef.current = null;
    }

    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
  }, []);

  const startAlarm = useCallback(async () => {
    if (oscillatorRef.current) return;

    const ready = await unlockAudio();
    if (!ready) return;

    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 0.04);
    gain.connect(ctx.destination);
    gainRef.current = gain;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    let toggle = false;
    const interval = window.setInterval(() => {
      if (audioCtxRef.current?.state !== 'running') return;
      toggle = !toggle;
      osc.frequency.setValueAtTime(toggle ? 660 : 880, audioCtxRef.current.currentTime);
    }, 500);

    osc.connect(gain);
    osc.start();
    oscillatorRef.current = osc;
    freqIntervalRef.current = interval;
    setAudioBlocked(false);
  }, [unlockAudio]);

  const startVibration = useCallback(() => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (vibrationTimerRef.current !== null) return;
    if (!interactionUnlockedRef.current) return;

    const pulse = () => navigator.vibrate([250, 150, 250, 700]);
    pulse();
    vibrationTimerRef.current = window.setInterval(pulse, 2500);
  }, []);

  const stopVibration = useCallback(() => {
    if (vibrationTimerRef.current !== null) {
      window.clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }

    if (
      interactionUnlockedRef.current &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate(0);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const primeAudio = () => {
      interactionUnlockedRef.current = true;
      void unlockAudio();
      if (alarmActive && !muted) {
        startVibration();
      }
    };

    for (const eventName of AUDIO_UNLOCK_EVENTS) {
      window.addEventListener(eventName, primeAudio, { passive: true });
    }

    return () => {
      for (const eventName of AUDIO_UNLOCK_EVENTS) {
        window.removeEventListener(eventName, primeAudio);
      }
    };
  }, [alarmActive, muted, startVibration, unlockAudio]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const resumeOnFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (alarmActive && !muted) {
        void startAlarm();
      }
    };

    window.addEventListener('focus', resumeOnFocus);
    document.addEventListener('visibilitychange', resumeOnFocus);

    return () => {
      window.removeEventListener('focus', resumeOnFocus);
      document.removeEventListener('visibilitychange', resumeOnFocus);
    };
  }, [alarmActive, muted, startAlarm]);

  useEffect(() => {
    if (alarmActive && !muted) {
      void startAlarm();
      startVibration();
    } else {
      stopAlarm();
      stopVibration();
      setAudioBlocked(false);
    }

    return () => {
      stopAlarm();
      stopVibration();
    };
  }, [alarmActive, muted, startAlarm, startVibration, stopAlarm, stopVibration]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);
  const enableSound = useCallback(() => {
    void unlockAudio().then((ready) => {
      if (ready && alarmActive && !muted) {
        void startAlarm();
      }
    });
  }, [alarmActive, muted, startAlarm, unlockAudio]);

  return { alarmActive, muted, audioBlocked, toggleMute, enableSound };
}
