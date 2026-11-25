import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ClipboardList, Lock, XCircle } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';

interface Question {
  id: string; type: 'MCQ' | 'TRUE_FALSE' | 'MULTIPLE_SELECT' | 'SHORT_ANSWER';
  prompt: string; points: number; options: Array<{ id: string; text: string }>;
}
interface ExamData {
  exam: { id: string; title: string; description: string | null; passingScore: number; timeLimitMinutes: number | null; courseTitle: string; questionCount: number };
  questions: Question[];
  attempts: Array<{ id: string; score: number; maxScore: number; passed: boolean; submittedAt: string }>;
}
interface Result {
  attempt: { id: string; score: number; maxScore: number; percent: number; passed: boolean };
  feedback: Array<{ questionId: string; prompt: string; correct: boolean; earnedPoints: number; correctAnswers: string[]; explanation?: string | null; correctOptionTexts: string[] }>;
  passingScore: number;
}

const typeLabels = { MCQ: 'اختيار من متعدد', TRUE_FALSE: 'صح / خطأ', MULTIPLE_SELECT: 'اختيار متعدد', SHORT_ANSWER: 'إجابة قصيرة' };

export default function ExamPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: queryKeys.exam(id!),
    queryFn: () => api.get<ExamData>(`/api/exams/${id}`),
    enabled: !!id,
  });

  const submit = useMutation({
    mutationFn: () => api.post<Result>(`/api/exams/${id}/attempts`, { answers }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: queryKeys.exam(id!) });
      queryClient.invalidateQueries({ queryKey: ['my-attempts'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'تعذّر إرسال الإجابات'),
  });

  if (isLoading) return <Spinner />;

  if (loadError instanceof ApiError && loadError.code === 'CONTENT_LOCKED') {
    return (
      <div className="mx-auto max-w-2xl animate-fade-up">
        <Card className="p-8 text-center">
          <Lock className="mx-auto mb-4 h-10 w-10 text-amber-700" />
          <h1 className="text-xl font-extrabold text-navy">هذا الاختبار مغلق</h1>
          <p className="mt-2 text-sm text-muted">اشترِ باقة الأسئلة أو الاشتراك المناسب لفتحه.</p>
          <Link to="/app/purchases" className="mt-6 inline-block"><Button>عرض الباقات</Button></Link>
        </Card>
      </div>
    );
  }
  if (!data) return <div className="text-sm text-rose-600">تعذّر تحميل الاختبار.</div>;

  const answeredCount = Object.values(answers).filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length;

  function setSingle(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }
  function toggleMulti(questionId: string, value: string) {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[] | undefined) ?? [];
      return { ...prev, [questionId]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
    });
  }

  if (result) {
    const { attempt } = result;
    return (
      <div className="mx-auto max-w-4xl animate-fade-up">
        <Link to="/app/results" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted"><ArrowRight className="h-3.5 w-3.5" /> كل الدرجات</Link>
        <Card className="overflow-hidden">
          <div className={`p-7 text-white ${attempt.passed ? 'bg-teal-dark' : 'bg-rose-700'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-white/80">نتيجة الاختبار</p>
                <h1 className="mt-1 text-2xl font-extrabold">{data.exam.title}</h1>
              </div>
              <div className="text-left">
                <p className="text-4xl font-extrabold">{attempt.percent}%</p>
                <p className="code-ltr text-sm text-white/80">{attempt.score} / {attempt.maxScore}</p>
              </div>
            </div>
            <p className="mt-4 text-sm font-bold">{attempt.passed ? 'مبروك، نجحت في الاختبار! 🎉' : `لم تصل لدرجة النجاح (${result.passingScore}%). حاول مرة أخرى.`}</p>
          </div>
          <div className="space-y-4 p-6">
            <h2 className="font-extrabold text-navy">مراجعة الإجابات</h2>
            {result.feedback.map((item, index) => (
              <div key={item.questionId} className={`rounded-xl border p-4 ${item.correct ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/40'}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-navy">{index + 1}. {item.prompt}</p>
                  {item.correct ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-600" />}
                </div>
                <p className="mt-2 text-xs text-muted">
                  الإجابة الصحيحة: <span className="font-bold text-teal-dark">{item.correctOptionTexts.join('، ') || item.correctAnswers.join('، ') || '—'}</span>
                  {' · '}النقاط: {item.earnedPoints}
                </p>
                {item.explanation && <p className="mt-2 text-xs leading-relaxed text-slate-600">{item.explanation}</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" onClick={() => { setResult(null); setAnswers({}); }}>إعادة المحاولة</Button>
              <Link to="/app/results"><Button variant="teal">عرض كل الدرجات</Button></Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl animate-fade-up">
      <Link to="/app/catalog" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted"><ArrowRight className="h-3.5 w-3.5" /> العودة</Link>
      <Card className="mb-6 overflow-hidden">
        <div className="bg-navy p-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-teal-200">{data.exam.courseTitle}</p>
              <h1 className="mt-1 text-2xl font-extrabold">{data.exam.title}</h1>
              <p className="mt-2 text-sm text-slate-300">{data.exam.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="gold">{data.exam.questionCount} أسئلة</Badge>
              <Badge tone="navy">نجاح: {data.exam.passingScore}%</Badge>
              {data.exam.timeLimitMinutes && <Badge tone="slate">{data.exam.timeLimitMinutes} دقيقة</Badge>}
            </div>
          </div>
        </div>
        {data.attempts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-4 text-xs">
            <ClipboardList className="h-4 w-4 text-muted" />
            <span className="font-bold text-muted">محاولات سابقة:</span>
            {data.attempts.map((attempt) => (
              <Badge key={attempt.id} tone={attempt.passed ? 'teal' : 'rose'}>{attempt.score}/{attempt.maxScore} · {attempt.passed ? 'ناجح' : 'غير ناجح'}</Badge>
            ))}
          </div>
        )}
      </Card>

      {error && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <div className="space-y-5">
        {data.questions.map((question, index) => (
          <Card key={question.id} className="p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy text-xs font-extrabold text-white">{index + 1}</span>
                <div>
                  <p className="font-bold text-navy">{question.prompt}</p>
                  <p className="mt-1 text-xs text-muted">{typeLabels[question.type]} · {question.points} نقطة</p>
                </div>
              </div>
              <Badge tone="slate">{question.points} نقطة</Badge>
            </div>

            {(question.type === 'MCQ' || question.type === 'TRUE_FALSE') && (
              <div className="space-y-2">
                {question.options.map((option) => (
                  <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${answers[question.id] === option.id ? 'border-teal bg-teal-light/50 font-bold text-teal-dark' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="radio" name={question.id} className="h-4 w-4 accent-teal" checked={answers[question.id] === option.id} onChange={() => setSingle(question.id, option.id)} />
                    {option.text}
                  </label>
                ))}
              </div>
            )}

            {question.type === 'MULTIPLE_SELECT' && (
              <div className="space-y-2">
                {question.options.map((option) => {
                  const selected = ((answers[question.id] as string[] | undefined) ?? []).includes(option.id);
                  return (
                    <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${selected ? 'border-teal bg-teal-light/50 font-bold text-teal-dark' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input type="checkbox" className="h-4 w-4 accent-teal" checked={selected} onChange={() => toggleMulti(question.id, option.id)} />
                      {option.text}
                    </label>
                  );
                })}
              </div>
            )}

            {question.type === 'SHORT_ANSWER' && (
              <input className="code-ltr text-left" value={(answers[question.id] as string | undefined) ?? ''} onChange={(e) => setSingle(question.id, e.target.value)} placeholder="اكتب إجابتك هنا..." />
            )}
          </Card>
        ))}
      </div>

      <div className="sticky bottom-20 mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-lift">
        <p className="text-xs font-bold text-muted">{answeredCount} من {data.questions.length} سؤال تمت الإجابة عليه</p>
        <Button loading={submit.isPending} disabled={answeredCount === 0} onClick={() => { if (!submit.isPending) submit.mutate(); }}>إرسال الإجابات وتصحيحها</Button>
      </div>
    </div>
  );
}
