import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Card, EmptyState, PageHeader, Spinner, formatDate } from '../../components/ui';

interface Attempt {
  id: string; score?: number; maxScore?: number; passed?: boolean; submittedAt: string;
  exam: { id: string; title: string; unit?: { course: { title: string } } };
}
interface AttemptDetail {
  attempt: { id: string; examTitle: string; score?: number; maxScore?: number; percent?: number; passed?: boolean; submittedAt: string };
  feedback: Array<{ questionId: string; prompt: string }>;
}

export default function Results() {
  const { attemptId } = useParams();
  const detail = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => api.get<AttemptDetail>(`/api/attempts/${attemptId}`),
    enabled: !!attemptId,
  });
  const list = useQuery({
    queryKey: ['my-attempts'],
    queryFn: () => api.get<{ attempts: Attempt[] }>('/api/student/me/attempts'),
    enabled: !attemptId,
  });

  if (attemptId) {
    if (detail.isLoading) return <Spinner />;
    if (!detail.data) return <div className="text-sm text-rose-600">تعذّر تحميل النتيجة.</div>;
    const { attempt, feedback } = detail.data;
    return (
      <div className="mx-auto max-w-3xl animate-fade-up">
        <Link to="/app/results" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted"><ArrowRight className="h-3.5 w-3.5" /> كل الدرجات</Link>
        <Card className="overflow-hidden">
          <div className="bg-navy p-6 text-white">
            <p className="text-xs font-bold text-teal-200">{formatDate(attempt.submittedAt)}</p>
            <h1 className="mt-1 text-2xl font-extrabold">{attempt.examTitle}</h1>
            {attempt.score !== undefined && attempt.maxScore !== undefined ? (
              <div className="mt-4 flex items-center gap-4">
                <p className="text-4xl font-extrabold">{attempt.percent}%</p>
                <Badge tone={attempt.passed ? 'teal' : 'rose'}>{attempt.passed ? 'ناجح' : 'غير ناجح'}</Badge>
                <p className="code-ltr text-sm text-slate-300">{attempt.score}/{attempt.maxScore}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">تم تسجيل المحاولة. لا يتم عرض درجات المحاولات المتكررة.</p>
            )}
          </div>
          <div className="space-y-3 p-6">
            {feedback.length === 0 && <p className="text-sm text-muted">لا توجد مراجعة تفصيلية لهذه المحاولة.</p>}
            {feedback.map((item, index) => (
              <div key={item.questionId} className="rounded-xl border border-slate-100 p-4">
                <p className="text-sm font-bold text-navy">{index + 1}. {item.prompt}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (list.isLoading) return <Spinner />;
  const attempts = list.data?.attempts ?? [];

  return (
    <div className="animate-fade-up">
      <PageHeader title="درجاتي" subtitle="جميع محاولاتك في الاختبارات مع إمكانية مراجعة الإجابات" />
      {attempts.length === 0 ? (
        <EmptyState title="لا توجد درجات بعد" description="افتح اختباراً من أي كورس وابدأ أول محاولة." action={<Link to="/app/catalog"><ButtonLink>تصفّح الكورسات</ButtonLink></Link>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الاختبار</th><th className="p-4">الكورس</th><th className="p-4">التاريخ</th><th className="p-4">الدرجة</th><th className="p-4">الحالة</th><th className="p-4"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {attempts.map((attempt) => {
                  const hasScore = attempt.score !== undefined && attempt.maxScore !== undefined;
                  const percent = hasScore && attempt.maxScore ? Math.round((attempt.score! / attempt.maxScore) * 100) : 0;
                  return (
                    <tr key={attempt.id} className="hover:bg-canvas">
                      <td className="p-4 font-bold text-navy">{attempt.exam.title}</td>
                      <td className="p-4 text-muted">{attempt.exam.unit?.course.title ?? '—'}</td>
                      <td className="p-4 text-muted">{formatDate(attempt.submittedAt)}</td>
                      <td className="p-4">
                        {hasScore ? (
                          <><span className="font-extrabold text-navy">{percent}%</span> <span className="code-ltr text-xs text-muted">{attempt.score}/{attempt.maxScore}</span></>
                        ) : (
                          <span className="text-xs text-muted">مسجّلة</span>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge tone={!hasScore ? 'slate' : attempt.passed ? 'teal' : 'rose'}>
                          {!hasScore ? 'غير متاحة' : attempt.passed ? 'ناجح' : 'غير ناجح'}
                        </Badge>
                      </td>
                      <td className="p-4"><Link to={`/app/results/${attempt.id}`} className="text-xs font-extrabold text-teal-dark hover:underline">مراجعة</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ButtonLink({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white">{children}</span>;
}
