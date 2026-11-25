import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  ClipboardList,
  CreditCard,
  GraduationCap,
  Home,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Package,
  Settings2,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../context/ThemeContext';
import { Button } from './ui';

const studentNav = [
  { to: '/app', label: 'الرئيسية', short: 'الرئيسية', icon: Home, end: true },
  { to: '/app/catalog', label: 'المواد والكورسات', short: 'الكورسات', icon: Library },
  { to: '/app/purchases', label: 'مشترياتي والدفع', short: 'الدفع', icon: Wallet },
  { to: '/app/results', label: 'درجاتي', short: 'درجاتي', icon: ClipboardList },
];

const adminNav = [
  { to: '/admin', label: 'نظرة عامة', short: 'الرئيسية', icon: LayoutDashboard, end: true },
  { to: '/admin/students', label: 'الطلاب', short: 'الطلاب', icon: Users },
  { to: '/admin/students/pending', label: 'طلبات التسجيل', short: 'التسجيل', icon: UserCheck },
  { to: '/admin/content', label: 'المواد والمحتوى', short: 'المحتوى', icon: BookOpen },
  { to: '/admin/exams', label: 'الأسئلة والاختبارات', short: 'الاختبارات', icon: ClipboardList },
  { to: '/admin/products', label: 'الباقات والأسعار', short: 'الباقات', icon: Package },
  { to: '/admin/payments', label: 'طلبات الدفع', short: 'الدفع', icon: CreditCard },
  { to: '/admin/progress', label: 'تقدم الطلاب', short: 'التقدم', icon: TrendingUp },
];

function NavItems({ items, onNavigate }: { items: typeof studentNav; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
              isActive ? 'bg-teal-light text-teal-dark' : 'text-slate-500 hover:bg-slate-50 hover:text-navy'
            }`
          }
        >
          <Icon className="h-[18px] w-[18px]" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function DashboardShell({ items, panelTitle }: { items: typeof studentNav; panelTitle: string }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes, and support Escape / backdrop dismissal.
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  // A long admin menu would be unreadable in the bottom bar on small phones.
  const bottomItems = items.length > 5 ? items.slice(0, 3) : items;
  const hasMore = items.length > bottomItems.length;
  const moreActive = hasMore && !bottomItems.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-100 bg-white px-4 backdrop-blur dark:bg-surface md:px-7">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="shrink-0 rounded-lg p-2 text-navy hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="القائمة"
            aria-expanded={open}
            aria-controls="dashboard-nav"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Logo to={items[0].to} compact />
          <span className="mr-1 hidden rounded-lg bg-navy/5 px-2.5 py-1 text-[11px] font-extrabold text-navy sm:inline">{panelTitle}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <div className="hidden text-left sm:block">
            <p className="text-xs font-bold text-navy">{user?.name}</p>
            <p className="code-ltr text-[10px] text-muted">{user?.email}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-extrabold text-white">
            {user?.name.charAt(0)}
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} title="تسجيل الخروج">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">خروج</span>
          </Button>
        </div>
      </header>

      {open && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-navy/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="mx-auto flex w-full max-w-[1500px]">
        <aside
          id="dashboard-nav"
          className={`fixed inset-y-0 right-0 z-50 flex w-[min(88vw,20rem)] flex-col overflow-y-auto border-l border-slate-100 bg-white px-4 pb-7 pt-5 shadow-2xl transition-transform duration-300 ease-out lg:sticky lg:bottom-auto lg:top-16 lg:z-auto lg:block lg:h-[calc(100vh-4rem)] lg:w-64 lg:translate-x-0 lg:px-4 lg:py-7 lg:shadow-none ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="mb-3 flex items-center justify-between px-2 lg:hidden">
            <span className="text-sm font-extrabold text-navy">القائمة الرئيسية</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" className="rounded-lg p-2 text-navy hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mb-4 hidden px-4 text-[11px] font-extrabold uppercase tracking-wider text-muted lg:block">القائمة الرئيسية</p>
          <NavItems items={items} onNavigate={() => setOpen(false)} />
          <div className="mt-8 rounded-2xl bg-navy p-4 text-white">
            <GraduationCap className="mb-2 h-6 w-6 text-gold" />
            <p className="text-xs font-bold">تعلّم بلا حدود</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">أكمل درساً واحداً اليوم واقترب من هدفك.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 pb-24 md:p-7 md:pb-24 lg:p-9 lg:pb-9">
          <Outlet />
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 flex justify-around border-t border-slate-100 bg-white px-2 py-2 backdrop-blur dark:bg-surface lg:hidden">
        {bottomItems.map(({ to, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-bold ${isActive ? 'text-teal-dark' : 'text-muted'}`}
          >
            <Icon className="h-5 w-5" />
            {short}
          </NavLink>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-bold ${moreActive ? 'text-teal-dark' : 'text-muted'}`}
          >
            <Menu className="h-5 w-5" />
            المزيد
          </button>
        )}
      </nav>
    </div>
  );
}

export function StudentLayout() {
  return <DashboardShell items={studentNav} panelTitle="مساحة الطالب" />;
}

export function AdminLayout() {
  return <DashboardShell items={adminNav} panelTitle="لوحة الإدارة" />;
}

export function PublicLayout() {
  return (
    <div className="min-h-screen">
      <Outlet />
      <footer className="border-t border-line bg-surface py-8 text-center text-xs text-muted">
        <div className="mb-3 flex justify-center"><Logo /></div>
        <div className="mb-4 flex justify-center"><ThemeToggle /></div>
        <p>© 2026 صموئيل أكاديمي — منصة تعليمية تجريبية (MVP)</p>
        <p className="mt-1">بيانات الدفع المعروضة تجريبية وغير حقيقية.</p>
      </footer>
    </div>
  );
}

export function DemoBadge() {
  return <span className="rounded-md bg-gold/20 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">DEMO</span>;
}

export function AdminOnlyLink() {
  return (
    <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-dark">
      <Settings2 className="h-3.5 w-3.5" /> لوحة الإدارة
    </Link>
  );
}
