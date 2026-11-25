import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, CreditCard, GraduationCap, Users, Wallet } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, StatCard, formatDate, formatMoney } from '../../components/ui';
import { errorMessage } from '../../context/AuthContext';

interface Overview {
  stats: { students: number; pendingStudents: number; pendingPayments: number; subjects: number; courses: number; lessons: number; exams: number; approvedRevenueCents: number };
  recentPayments: Array<{ id: string; reference: string; amountCents: number; method: string; createdAt: string; user: { name: string; email: string }; product: { name: string } }>;
}

const sections = [
  { to: '/admin/students', label: 'إدارة الطلاب', icon: Users, note: 'عرض الطلاب وصلاحياتهم' },
  { to: '/admin/students/pending', label: 'طلبات التسجيل', icon: Users, note: 'قبول أو رفض الحسابات الجديدة' },
  { to: '/admin/content', label: 'المواد والكورسات', icon: BookOpen, note: 'وحدات ودروس ومصادر' },
  { to: '/admin/exams', label: 'الأسئلة والاختبارات', icon: ClipboardList, note: 'أنشئ اختبارات وراجع تصحيحها' },
  { to: '/admin/products', label: 'الباقات والأسعار', icon: Wallet, note: 'حدّث الأسعار ومدد الوصول' },
  { to: '/admin/payments', label: 'مراجعة المدفوعات', icon: CreditCard, note: 'اعتماد أو رفض الطلبات' },
  { to: '/admin/progress', label: 'تقدم الطلاب', icon: GraduationCap, note: 'نسب الإكمال والدرجات' },
];

export default function AdminDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: queryKeys.adminOverview, queryFn: () => api.get<Overview>('/api/admin/overview') });
  if (isLoading) return <Spinner />;
  if (error) return <div className="p-4"><Alert kind="error">{errorMessage(error)}</Alert></div>;
  if (!data) return null;

  return (
    <div className="animate-fade-up">
      <PageHeader title="لوحة التحكم" subtitle="نظرة شاملة على المنصة وأحدث الطلبات" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="الطلاب" value={data.stats.students} icon={<Users className="h-5 w-5" />} note={`${data.stats.pendingStudents} بانتظار الموافقة`} />
        <StatCard label="طلبات معلّقة" value={data.stats.pendingPayments} icon={<CreditCard className="h-5 w-5" />} note="بانتظار المراجعة" />
        <StatCard label="المحتوى التعليمي" value={data.stats.lessons} icon={<BookOpen className="h-5 w-5" />} note={`${data.stats.subjects} مواد · ${data.stats.courses} كورسات · ${data.stats.exams} اختبارات`} />
        <StatCard label="إجمالي المعتمد" value={formatMoney(data.stats.approvedRevenueCents)} icon={<Wallet className="h-5 w-5" />} note="قيمة الطلبات المعتمدة (تجريبي)" />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="mb-4 text-lg font-extrabold text-navy">أحدث طلبات الدفع</h2>
          {data.recentPayments.length === 0 ? (
            <EmptyState title="لا توجد طلبات معلّقة" description="ستظهر طلبات الطلاب هنا فور إرسالها." />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-right text-sm">
                  <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الطالب</th><th className="p-4">الباقة</th><th className="p-4">المرجع</th><th className="p-4">المبلغ</th><th className="p-4"></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-canvas">
                        <td className="p-4"><p className="font-bold text-navy">{payment.user.name}</p><p className="code-ltr text-[11px] text-muted">{payment.user.email}</p></td>
                        <td className="p-4 text-muted">{payment.product.name}</td>
                        <td className="code-ltr p-4 text-xs">{payment.reference}</td>
                        <td className="p-4 font-extrabold text-navy">{formatMoney(payment.amountCents)}</td>
                        <td className="p-4"><Badge tone="gold">قيد المراجعة</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 p-4"><Link to="/admin/payments" className="text-xs font-extrabold text-teal-dark hover:underline">عرض كل الطلبات ←</Link></div>
            </Card>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-extrabold text-navy">إدارة سريعة</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {sections.map(({ to, label, note, icon: Icon }) => (
              <Link key={to} to={to}>
                <Card className="flex items-center gap-3 p-4 transition hover:border-teal hover:shadow-lift">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-light text-teal-dark"><Icon className="h-5 w-5" /></div>
                  <div><p className="text-sm font-extrabold text-navy">{label}</p><p className="text-xs text-muted">{note}</p></div>
                </Card>
              </Link>
            ))}
          </div>
          <p className="mt-5 flex items-center gap-1.5 text-xs text-muted"><CreditCard className="h-3.5 w-3.5" /> آخر تحديث: {formatDate(new Date())}</p>
        </section>
      </div>
    </div>
  );
}
