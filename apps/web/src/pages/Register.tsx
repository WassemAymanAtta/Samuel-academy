import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';
import { errorMessage, useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('كلمتا المرور غير متطابقتين');
    setLoading(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined });
      setPending(true);
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
        <h1 className="mt-10 text-3xl font-extrabold leading-snug text-navy">ابدأ رحلتك معنا اليوم</h1>
        <p className="mt-4 max-w-md text-sm leading-loose text-muted">أنشئ حساب طالب جديد، وتصفّح الكورسات، واشترِ ما يناسبك، وتابع تقدّمك خطوة بخطوة.</p>
        <ul className="mt-8 space-y-3 text-sm font-bold text-slate-600">
          <li>✓ حسابك مجاني تماماً</li><li>✓ تصفح المحتوى قبل الشراء</li><li>✓ لوحة تقدّم ودرجات مفصّلة</li>
        </ul>
      </div>
      <Card className="p-7 md:p-9">
        <div className="mb-7 text-center md:hidden"><Logo /></div>
        <h2 className="text-2xl font-extrabold text-navy">إنشاء حساب طالب</h2>
        <p className="mt-1 text-sm text-muted">بياناتك محفوظة بأمان في قاعدة البيانات</p>
        {pending ? (
          <div className="mt-7 space-y-4">
            <Alert kind="success">
              تم إنشاء حسابك بحالة <strong>Pending</strong>. يحتاج موافقة الإدارة قبل تسجيل الدخول واستخدام المنصة.
            </Alert>
            <p className="text-center text-sm text-muted">ستتمكن من الدخول فور اعتماد حسابك من لوحة الإدارة.</p>
            <Link to="/login" className="block"><Button className="w-full">العودة إلى تسجيل الدخول</Button></Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-4">
            {error && <Alert kind="error">{error}</Alert>}
          <Field label="الاسم الكامل">
            <TextInput required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="اسمك" />
          </Field>
          <Field label="البريد الإلكتروني">
            <TextInput required type="email" dir="ltr" className="code-ltr text-left" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="رقم الهاتف (اختياري)">
            <TextInput dir="ltr" className="code-ltr text-left" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="01xxxxxxxxx" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="كلمة المرور">
              <TextInput required minLength={8} maxLength={100} type="password" dir="ltr" className="code-ltr text-left" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="8 أحرف فأكثر" />
            </Field>
            <Field label="تأكيد كلمة المرور">
              <TextInput required type="password" dir="ltr" className="code-ltr text-left" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} placeholder="••••••••" />
            </Field>
          </div>
            <Button loading={loading} className="w-full">إنشاء الحساب</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">لديك حساب بالفعل؟ <Link to="/login" className="font-extrabold text-teal-dark hover:underline">سجّل الدخول</Link></p>
      </Card>
    </div>
  );
}
