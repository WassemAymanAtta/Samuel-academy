import { Link } from 'react-router-dom';

interface LogoProps {
  compact?: boolean;
  to?: string;
  light?: boolean;
}

/** Original mark: an open book, a code bracket, and a small achievement star. */
export function Mark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="شعار صموئيل أكاديمي">
      <rect width="64" height="64" rx="16" fill="#102A56" />
      <path d="M12 18c7-3 13-2 20 2 7-4 13-5 20-2v27c-7-3-13-2-20 2-7-4-13-5-20-2V18Z" fill="none" stroke="#F4B740" strokeWidth="3" strokeLinejoin="round" />
      <path d="M25 24l-5 7 5 7M39 24l5 7-5 7" fill="none" stroke="#12A6A0" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m32 23 1.7 3.6 3.9.5-2.9 2.7.8 3.9L32 31.6l-3.5 2.1.8-3.9-2.9-2.7 3.9-.5L32 23Z" fill="#F4B740" />
    </svg>
  );
}

export function Logo({ compact = false, to = '/', light = false }: LogoProps) {
  return (
    <Link to={to} className="flex items-center gap-3 no-underline">
      <img src="/samuel-logo.png" alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1 shadow-sm" />
      <div className="leading-tight">
        <div className={`text-base font-extrabold ${light ? 'text-white' : 'text-navy'}`}>صموئيل أكاديمي</div>
        {!compact && <div className={`text-[10px] font-bold tracking-widest ${light ? 'text-teal-200' : 'text-teal-dark'}`}>SAMUEL ACADEMY</div>}
      </div>
    </Link>
  );
}
