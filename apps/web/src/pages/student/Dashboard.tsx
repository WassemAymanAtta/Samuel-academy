import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, BookOpen, CheckCircle2, Clock3, CreditCard, PlayCircle, TrendingUp } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, Spinner, StatCard, formatDate, formatMoney } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

interface DashboardData {
  enrolled: Array<{
    id: string; title: string; subject: string; subjectIcon: string | null; level: string | null;
    totalLessons: number; completedLessons: number; progress: number; unitsCount: number;
    nextLesson: { id: string; title: string; unitTitle: string } | null;
  }>;
  continueLearning: Array<{ courseId: string; courseTitle: string; lesson: { id: string; title: string; unitTitle: string } }>;
  purchases: Array<{ id: string; productName: string; type: string; grantedAt: string; expiresAt: string | null; permanent: boolean }>;
  recentAttempts: Array<{ id: string; examTitle: string; courseTitle: string; score: number; maxScore: number; percent: number; passed: boolean; submittedAt: string }>;
  pendingPayments: Array<{ id: string; productName: string; amountCents: number; method: string; reference: string; status: string; createdAt: string }>;
  stats: { courses: number; completedLessons: number; averageProgress: number; examsTaken: number };
}

const typeLabels: Record<string, string> = {
  MONTHLY: 'اشتراك شهري', TERM: 'اشتراك فصلي', UNIT: 'وحدة', LESSON: 'درس', EXAM_PACKAGE: 'باقة أسئلة',
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<DashboardData>('/api/student/dashboard'),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <div className="text-sm text-rose-600">تعذّر تحميل لوحة الطالب.</div>;
  if (!data) return null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`أهلاً ${user?.name?.split(' ')[0]} 👋`}
        subtitle="هذه نظرة سريعة على تقدّمك والخطوة التالية في رحلتك"
        action={<Link to="/app/catalog"><Button variant="outline">تصفّح الكورسات <ArrowLeft className="h-4 w-4" /></Button></Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="كورساتي" value={data.stats.courses} icon={<BookOpen className="h-5 w-5" />} note="كورسات تملك صلاحية الوصول إليها" />
        <StatCard label="دروس مكتملة" value={data.stats.completedLessons} icon={<CheckCircle2 className="h-5 w-5" />} note="من إجمالي الدروس المتاحة" />
        <StatCard label="متوسط التقدّم" value={`${data.stats.averageProgress}%`} icon={<TrendingUp className="h-5 w-5" />} note="عبر جميع كورساتك" />
        <StatCard label="اختبارات أجريتها" value={data.stats.examsTaken} icon={<Award className="h-5 w-5" />} note="مع تصحيح فوري" />
      </div>

      {data.continueLearning.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2"><PlayCircle className="h-5 w-5 text-teal" /><h2 className="text-lg font-extrabold text-navy">أكمل من حيث توقفت</h2></div>
          <div className="grid gap-4 lg:grid-cols-3">
            {data.continueLearning.map((item) => (
              <Card key={item.courseId} className="p-5 transition hover:shadow-lift">
                <p className="text-xs font-bold text-teal-dark">{item.courseTitle}</p>
                <p className="mt-2 text-sm font-extrabold text-navy">{item.lesson.title}</p>
                <p className="mt-1 text-xs text-muted">{item.lesson.unitTitle}</p>
                <Link to={`/app/lesson/${item.lesson.id}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-extrabold text-teal-dark hover:underline">
                  متابعة الدرس <ArrowLeft className="h-3.5 w-3.5" />
                </Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="mb-4 text-lg font-extrabold text-navy">كورساتي وتقدّمي</h2>
          {data.enrolled.length === 0 ? (
            <EmptyState
              title="لم تشترِ أي كورس بعد"
              description="تصفّح المواد واختر اشتراكاً أو وحدة تناسبك. سيظهر الكورس هنا فور اعتماد الدفع."
              action={<Link to="/app/catalog"><Button>تصفّح المحتوى</Button></Link>}
            />
          ) : (
            <div className="space-y-4">
              {data.enrolled.map((course) => (
                <Card key={course.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-sm font-extrabold text-navy">
                        {course.subjectIcon || <BookOpen className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="font-extrabold text-navy">{course.title}</p>
                        <p className="text-xs text-muted">{course.subject} · {course.unitsCount} وحدات · {course.level ?? 'عام'}</p>
                      </div>
                    </div>
                    <Badge tone="teal">{course.progress}%</Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <ProgressBar value={course.progress} className="flex-1" />
                    <span className="whitespace-nowrap text-xs font-bold text-muted">{course.completedLessons}/{course.totalLessons} درس</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-muted">{course.nextLesson ? `التالي: ${course.nextLesson.title}` : 'أكملت كل الدروس المتاحة 🎉'}</p>
                    <Link to={`/app/course/${course.id}`} className="text-xs font-extrabold text-teal-dark hover:underline">عرض الكورس</Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <h2 className="mb-4 text-lg font-extrabold text-navy">آخر الدرجات</h2>
            <Card className="divide-y divide-slate-100">
              {data.recentAttempts.length === 0 && <p className="p-5 text-sm text-muted">لا توجد درجات بعد.</p>}
              {data.recentAttempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-navy">{attempt.examTitle}</p>
                    <p className="text-xs text-muted">{formatDate(attempt.submittedAt)}</p>
                  </div>
                  <div className="text-left">
                    <p className={`text-sm font-extrabold ${attempt.passed ? 'text-teal-dark' : 'text-rose-600'}`}>{attempt.percent}%</p>
                    <p className="code-ltr text-[10px] text-muted">{attempt.score}/{attempt.maxScore}</p>
                  </div>
                </div>
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-extrabold text-navy">مدفوعات قيد المراجعة</h2>
            <Card className="p-5">
              {data.pendingPayments.length === 0 ? (
                <p className="text-sm text-muted">لا توجد طلبات معلّقة.</p>
              ) : (
                <div className="space-y-3">
                  {data.pendingPayments.map((payment) => (
                    <div key={payment.id} className="rounded-xl bg-gold-light/60 p-3">
                      <div className="flex items-center justify-between gap-2"><p className="text-xs font-extrabold text-navy">{payment.productName}</p><Badge tone="gold">قيد المراجعة</Badge></div>
                      <p className="mt-1 text-xs text-muted">{formatMoney(payment.amountCents)} · {formatDate(payment.createdAt)}</p>
                    </div>
                  ))}
                  <Link to="/app/purchases" className="inline-flex items-center gap-1 text-xs font-extrabold text-teal-dark">إدارة الطلبات <ArrowLeft className="h-3.5 w-3.5" /></Link>
                </div>
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-extrabold text-navy">مشترياتي</h2>
            <Card className="divide-y divide-slate-100">
              {data.purchases.length === 0 && <p className="p-5 text-sm text-muted">لا توجد مشتريات بعد.</p>}
              {data.purchases.slice(0, 4).map((purchase) => (
                <div key={purchase.id} className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-bold text-navy">{purchase.productName}</p>
                    <p className="text-xs text-muted">{typeLabels[purchase.type] ?? purchase.type}</p>
                  </div>
                  <Badge tone={purchase.permanent ? 'teal' : 'navy'}>{purchase.permanent ? 'دائم' : formatDate(purchase.expiresAt)}</Badge>
                </div>
              ))}
            </Card>
          </section>

          <Card className="bg-navy p-5 text-white">
            <CreditCard className="mb-2 h-6 w-6 text-gold" />
            <p className="text-sm font-extrabold">تريد الوصول لكل شيء؟</p>
            <p className="mt-1 text-xs text-slate-300">الاشتراك الشهري يفتح لك جميع الكورسات.</p>
            <Link to="/app/purchases" className="mt-4 inline-block"><Button variant="gold" size="sm">عرض الباقات</Button></Link>
          </Card>

          <p className="flex items-center gap-1.5 text-xs text-muted"><Clock3 className="h-3.5 w-3.5" /> التقدّم يُحدّث فور إكمال كل درس.</p>
        </div>
      </div>
    </div>
  );
}
