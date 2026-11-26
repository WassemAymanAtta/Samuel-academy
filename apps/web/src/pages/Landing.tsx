import { Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, BookOpen, CheckCircle2, ClipboardCheck, Code2, GraduationCap, PlayCircle, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Badge, Button, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../context/ThemeContext';
import { usePublicConfig } from '../hooks/usePublicConfig';

const features = [
  { icon: BookOpen, title: 'محتوى منظّم', text: 'مادة ← كورس ← وحدة ← درس، مع تقدّم واضح لكل خطوة.' },
  { icon: PlayCircle, title: 'فيديو وملفات PDF', text: 'شاهد الشرح وافتح المصادر مباشرة من داخل الدرس.' },
  { icon: ClipboardCheck, title: 'اختبارات وتصحيح فوري', text: 'اختيار من متعدد، صح/خطأ، متعدد الإجابات، وإجابة قصيرة.' },
  { icon: Wallet, title: 'دفع يدوي مبسّط', text: 'أرسل رقم العملية وتراجع الإدارة الطلب وتفعّل الصلاحية تلقائياً.' },
];

export default function Landing() {
  const { user } = useAuth();
  const config = usePublicConfig();
  const showDemoAccounts = config.data?.demoMode === true;
  const home = user?.role === 'ADMIN' ? '/admin' : '/app';

  return (
    <div>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-9">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-bold text-slate-500 md:flex">
          <a href="#features" className="hover:text-navy">المميزات</a>
          <a href="#demo" className="hover:text-navy">الحسابات التجريبية</a>
          <a href="#content" className="hover:text-navy">المحتوى</a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/login"><Button variant="ghost" size="sm">دخول</Button></Link>
          <Link to="/register"><Button size="sm">ابدأ مجاناً</Button></Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-8 md:grid-cols-2 md:px-9 md:pb-24 md:pt-14">
        <div className="animate-fade-up">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-teal-light px-4 py-2 text-xs font-extrabold text-teal-dark">
            <Sparkles className="h-4 w-4" /> تعليم عربي عملي وجاهز للتجربة
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.25] tracking-tight text-ink md:text-5xl">
            تعلّم البرمجة بخطوات عملية واضحة
          </h1>
          <p className="mt-5 max-w-xl text-base leading-loose text-muted">
            صموئيل أكاديمي تجمع بين دروس فيديو، ملفات PDF، واختبارات قصيرة في منصة واحدة. تابع تقدّمك، اشترِ ما يناسبك، وابدأ من حيث توقفت.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? home : '/register'}>
              <Button size="md" className="px-7">ابدأ التعلّم الآن <ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <Link to="/login"><Button variant="outline" size="md" className="px-7">تجربة الحسابات</Button></Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-5 text-xs font-bold text-slate-500">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-teal" /> واجهة عربية RTL</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-teal" /> صلاحيات حقيقية</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-teal" /> بيانات تجريبية</span>
          </div>
        </div>

        <div className="relative animate-fade-up">
          <div className="absolute -left-6 -top-6 h-32 w-32 rounded-full bg-gold/20 blur-2xl" />
          <Card className="relative overflow-hidden">
            <div className="bg-navy px-6 py-5 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-extrabold"><GraduationCap className="h-5 w-5 text-gold" /> مسارك التعليمي</div>
                <Badge tone="gold">DEMO</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-300">مثال على لوحة الطالب بعد الدخول</p>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-light text-teal-dark code-ltr">{'< />'}</div>
                  <div><p className="text-sm font-bold text-navy">أساسيات JavaScript</p><p className="text-xs text-muted">6 دروس · الوحدة الأولى</p></div>
                </div>
                <Badge tone="teal">٢٥٪</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/4 rounded-full bg-teal" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-canvas p-4"><p className="text-xs text-muted">الدروس المكتملة</p><p className="mt-1 text-2xl font-extrabold text-navy">٣</p></div>
                <div className="rounded-xl bg-canvas p-4"><p className="text-xs text-muted">آخر درجة</p><p className="mt-1 text-2xl font-extrabold text-navy">١٠٠٪</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-gold/30 bg-gold-light p-4">
                <BadgeCheck className="h-5 w-5 text-amber-700" />
                <p className="text-xs font-bold text-amber-900">طلب دفع قيد المراجعة — سيظهر فوراً بعد اعتماد الإدارة</p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section id="features" className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-5 md:px-9">
          <h2 className="text-center text-2xl font-extrabold text-navy md:text-3xl">كل ما تحتاجه للتعلّم في مكان واحد</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="p-6 transition hover:-translate-y-1 hover:shadow-lift">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-light text-teal-dark"><Icon className="h-5 w-5" /></div>
                <h3 className="font-extrabold text-navy">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="content" className="mx-auto max-w-7xl px-5 py-16 md:px-9">
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-7">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy code-ltr text-gold">{'< />'}</div>
              <div><h3 className="font-extrabold text-navy">البرمجة وتقنية المعلومات</h3><p className="text-xs text-muted">مسارات عملية من الصفر</p></div>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>• أساسيات JavaScript</p><p>• Python للمبتدئين</p><p>• دروس، ملفات PDF، واختبارات قصيرة</p>
            </div>
          </Card>
          <Card className="p-7">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-light text-xl font-extrabold text-amber-800 code-ltr">Py</div>
              <div><h3 className="font-extrabold text-ink">بايثون للمبتدئين</h3><p className="text-xs text-muted">مسار عملي من الصفر</p></div>
            </div>
            <div className="space-y-2 text-sm text-muted">
              <p>• تجهيز بيئة العمل وأول برنامج</p><p>• الأرقام والنصوص والقوائم</p><p>• مشروع دفتر ملاحظات</p>
            </div>
          </Card>
        </div>
      </section>

      {showDemoAccounts && (
        <section id="demo" className="bg-navy py-16 text-white">
          <div className="mx-auto max-w-7xl px-5 md:px-9">
            <div className="mb-9 text-center">
              <h2 className="text-2xl font-extrabold md:text-3xl">جرّب المنصة فوراً بحساب تجريبي</h2>
              <p className="mt-2 text-sm text-slate-300">جميع البيانات وأرقام الدفع أدناه تجريبية بالكامل — DEMO</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {[
                { role: 'طالب', email: 'student@samuelacademy.com', pass: 'Student@12345', icon: GraduationCap },
                { role: 'مدير / معلم', email: 'admin@samuelacademy.com', pass: 'Admin@12345', icon: ShieldCheck },
              ].map(({ role, email, pass, icon: Icon }) => (
                <Card key={role} className="border-0 bg-white/5 p-6 text-white backdrop-blur">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-extrabold"><Icon className="h-5 w-5 text-gold" /> {role}</div>
                    <Badge>DEMO</Badge>
                  </div>
                  <p className="code-ltr text-sm text-slate-200">{email}</p>
                  <p className="code-ltr mt-1 text-sm text-slate-200">{pass}</p>
                  <Link to="/login" className="mt-5 inline-block"><Button variant="gold" size="sm">تسجيل الدخول</Button></Link>
                </Card>
              ))}
            </div>
            <p className="mt-8 text-center text-xs text-slate-300">
              ملاحظة: لا يتم التحقق تلقائياً من تحويلات InstaPay في هذه النسخة. المراجعة يدوية بالكامل.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
