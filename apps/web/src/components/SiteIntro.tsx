import { useEffect, useState } from 'react';
import { Mark } from './Logo';

const INTRO_KEY = 'sa_intro_seen';

/** Short branded splash shown once per tab, then remembered for the session. */
export default function SiteIntro() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.sessionStorage.getItem(INTRO_KEY)) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.sessionStorage.setItem(INTRO_KEY, '1');
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(INTRO_KEY, '1');
      setVisible(false);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="مقدمة صموئيل أكاديمي"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-navy text-white"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(18,166,160,0.45),transparent_60%)]" />
      <div className="relative animate-intro-pop">
        <div className="animate-intro-ring rounded-2xl">
          <Mark className="h-20 w-20 md:h-24 md:w-24" />
        </div>
      </div>
      <p className="mt-7 animate-intro-text text-xl font-extrabold tracking-tight md:text-2xl">صموئيل أكاديمي</p>
      <p className="mt-1 animate-intro-text text-[11px] font-bold tracking-[0.35em] text-teal-200 [animation-delay:120ms]">SAMUEL ACADEMY</p>
      <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-white/15">
        <div className="h-full w-full origin-right animate-intro-line rounded-full bg-gold" />
      </div>
    </div>
  );
}
