import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';
import { errorMessage, useAuth } from '../context/AuthContext';
import { usePublicConfig } from '../hooks/usePublicConfig';

const demoAccounts = [
  { label: 'طالب', email: 'student@samuelacademy.com', password: 'Student@12345' },
  { label: 'مدير / معلم', email: 'admin@samuelacademy.com', password: 'Admin@12345' },
];

export default function Login() {
  const { login } = useAuth();
  const config = usePublicConfig();
  const showDemoAccounts = config.data?.demoMode === true;
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(() => sessionStorage.getItem('sa_session_notice') ?? '');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      sessionStorage.removeItem('sa_session_notice');
      navigate(from || (user.role === 'ADMIN' ? '/admin' : '/app'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl items-center gap-10 px-5 py-12 md:grid-cols-2 md:px-9">
      <div className="hidden md:block">
        <Logo />
        <h1 className="mt-10 text-3xl font-extrabold leading-snug text-navy">أهلاً بعودتك 👋</h1>
        <p className="mt-4 max-w-md text-sm leading-loose text-muted">سجّل الدخول لمتابعة دروسك، مراجعة درجاتك، أو إدارة المحتوى والطلبات من لوحة التحكم.</p>
        {showDemoAccounts && (
          <>
            <div className="mt-9 space-y-4">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  onClick={() => { setEmail(account.email); setPassword(account.password); }}
                  className="flex w-full max-w-md items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-right transition hover:border-teal"
                >
                  <div>
                    <p className="text-xs font-bold text-teal-dark">حساب {account.label} التجريبي · DEMO</p>
                    <p className="code-ltr mt-1 text-sm text-navy">{account.email}</p>
                    <p className="code-ltr text-xs text-muted">{account.password}</p>
                  </div>
                  <span className="rounded-lg bg-gold-light px-2.5 py-1 text-[10px] font-extrabold text-amber-800">DEMO</span>
                </button>
              ))}
            </div>
            <p className="mt-5 max-w-md text-xs leading-relaxed text-muted">اضغط على أي حساب لتعبئة البيانات تلقائياً ثم اضغط «تسجيل الدخول».</p>
          </>
        )}
        <p className="mt-3 max-w-md rounded-xl bg-gold-light p-3 text-xs leading-relaxed text-amber-900">
          الحسابات الجديدة تبدأ بحالة <strong>Pending</strong> ولا يمكن تسجيل الدخول قبل موافقة الإدارة.
        </p>
      </div>

      <Card className="p-7 md:p-9">
        <div className="mb-7 text-center md:hidden"><Logo /></div>
        <h2 className="text-2xl font-extrabold text-navy">تسجيل الدخول</h2>
        <p className="mt-1 text-sm text-muted">أدخل بيانات حسابك للمتابعة</p>

        {error && <div className="mt-5"><Alert kind="error">{error}</Alert></div>}

        <form onSubmit={submit} className="mt-7 space-y-5">
          <Field label="البريد الإلكتروني">
            <div className="relative">
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="pr-10 code-ltr text-left" dir="ltr" />
            </div>
          </Field>
          <Field label="كلمة المرور">
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput type={show ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pr-10 code-ltr text-left" dir="ltr" />
              <button type="button" onClick={() => setShow(!show)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy" aria-label="إظهار كلمة المرور">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" loading={loading} className="w-full">تسجيل الدخول <ArrowLeft className="h-4 w-4" /></Button>
        </form>

        {showDemoAccounts && (
          <div className="mt-6 space-y-3 md:hidden">
            {demoAccounts.map((account) => (
              <button key={account.email} onClick={() => { setEmail(account.email); setPassword(account.password); }} className="w-full rounded-xl bg-canvas p-3 text-right text-xs">
                <span className="font-extrabold text-teal-dark">DEMO · {account.label}</span>
                <span className="code-ltr mr-2 text-muted">{account.email}</span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-7 text-center text-sm text-muted">ليس لديك حساب؟ <Link to="/register" className="font-extrabold text-teal-dark hover:underline">أنشئ حساب طالب</Link></p>
      </Card>
    </div>
  );
}
