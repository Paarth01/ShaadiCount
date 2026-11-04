'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Camera QR scanner using the browser BarcodeDetector API where available (Chromium/Android). Falls back to manual entry elsewhere. */
export function QrScanner({ onCode, paused }: { onCode: (code: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'idle' | 'on' | 'unsupported' | 'denied'>('idle');
  const stream = useRef<MediaStream | null>(null);
  const last = useRef({ code: '', at: 0 });
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (state !== 'on' || !video.current || !stream.current) return;
    const v = video.current;
    v.srcObject = stream.current;
    void v.play();
    const Detector = (window as any).BarcodeDetector;
    const det = new Detector({ formats: ['qr_code'] });
    let raf = 0;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (!paused && v.readyState >= 2) {
        try {
          const codes = await det.detect(v);
          const val: string | undefined = codes[0]?.rawValue;
          // Debounce: the same code is not re-reported for 3 seconds.
          if (val && (val !== last.current.code || Date.now() - last.current.at > 3000)) {
            last.current = { code: val, at: Date.now() };
            onCode(val);
          }
        } catch {
          /* frame not ready */
        }
      }
      raf = requestAnimationFrame(() => setTimeout(tick, 150));
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [state, paused, onCode]);

  async function start() {
    if (!supported) {
      setState('unsupported');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setState('on');
    } catch {
      setState('denied');
    }
  }
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState('idle');
  }

  return (
    <div>
      {state === 'on' ? (
        <>
          <video
            ref={video}
            muted
            playsInline
            style={{ width: '100%', borderRadius: 14, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }}
            aria-label="Camera view for scanning QR codes"
          />
          <Button block onClick={stop}>
            Stop camera
          </Button>
        </>
      ) : (
        <Button block onClick={start}>
          Start camera scan
        </Button>
      )}
      {state === 'unsupported' && <p className="muted">This browser cannot scan QR codes. Type the 12-character code below instead.</p>}
      {state === 'denied' && <p className="err">Camera access was blocked. Allow it in your browser settings or type the code instead.</p>}
    </div>
  );
}
