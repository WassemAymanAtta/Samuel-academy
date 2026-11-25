import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, Lock } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';

interface Question {
  id: string; type: 'MCQ' | 'TRUE_FALSE' | 'MULTIPLE_SELECT' | 'SHORT_ANSWER';
  prompt: string; points: number; options: Array<{ id: string; text: string }>;
}
interface ExamData {
  exam: {
    id: string; title: string; description: string | null; passingScore: number;
    timeLimitMinutes: number | null; maxAttempts: number | null;
    courseTitle: string; questionCount: number;
  };
  questions: Question[];
  attempts: Array<{ id: string; score?: number; maxScore?: number; passed?: boolean; submittedAt: string }>;
}
interface SessionData {
  id: string;
  status: 'active' | 'submitted' | 'abandoned' | 'expired';
  startedAt: string;
  expiresAt: string | null;
  idempotencyKey: string | null;
}
interface StartResult {
  session: SessionData;
  exam: { maxAttempts: number | null; timeLimitMinutes: number | null };
  attempt?: { id: string; submittedAt: string };
}
interface Result {
  attempt: { id: string; score?: number; maxScore?: number; percent?: number; passed?: boolean; submittedAt?: string };
  feedback?: Array<{ questionId: string; prompt: string }>;
  passingScore?: number;
  repeated?: boolean;
  message?: string;
}

const typeLabels = { MCQ: 'اختيار من متعدد', TRUE_FALSE: 'صح / خطأ', MULTIPLE_SELECT: 'اختيار متعدد', SHORT_ANSWER: 'إجابة قصيرة' };

export default function ExamPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [session, setSession] = useState<SessionData | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: queryKeys.exam(id!),
    queryFn: () => api.get<ExamData>(`/api/exams/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (!session?.expiresAt || result) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.expiresAt, result]);

  const start = useMutation({
    mutationFn: () => {
      const key = crypto.randomUUID();
      return api.post<StartResult>(`/api/exams/${id}/attempts/start`, undefined, {
        'Idempotency-Key': key,
      }).then((response) => ({ ...response, key }));
    },
    onSuccess: ({ session: next, key, attempt }) => {
      setAnswers({});
      setResult(null);
      setError('');
      setNowMs(Date.now());
      queryClient.invalidateQueries({ queryKey: queryKeys.exam(id!) });

      if (next.status === 'active') {
        setSession(next);
        setIdempotencyKey(key);
        setSessionNotice(null);
        return;
      }

      // Idempotent replay of an old session must not become an active exam.
      // The server already returned the original state; clear local session state
      // and let the student start again with a fresh Idempotency-Key.
      setSession(null);
      setIdempotencyKey(null);
      if (next.status === 'submitted') {
        setSessionNotice(
          attempt?.id
            ? `هذه الجلسة تم إرسالها بالفعل (${attempt.id}). ابدأ جلسة جديدة بمفتاح طلب جديد.`
            : 'هذه الجلسة تم إرسالها بالفعل. ابدأ جلسة جديدة بمفتاح طلب جديد.',
        );
      } else if (next.status === 'abandoned') {
        setSessionNotice('هذه الجلسة ملغاة. ابدأ جلسة جديدة بمفتاح طلب جديد.');
      } else {
        setSessionNotice('انتهت صلاحية هذه الجلسة. ابدأ جلسة جديدة بمفتاح طلب جديد.');
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر بدء الاختبار'),
  });

  const abandon = useMutation({
    mutationFn: () => api.post(`/api/exams/${id}/attempts/session/abandon`, { sessionId: session!.id }),
    onSuccess: () => {
      setSession(null);
      setIdempotencyKey(null);
      setAnswers({});
      setResult(null);
      setError('');
      setSessionNotice(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.exam(id!) });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر إلغاء الجلسة'),
  });

  const submit = useMutation({
    mutationFn: () => api.post<Result>(`/api/exams/${id}/attempts`, {
      sessionId: session!.id,
      answers,
    }, {
      'Idempotency-Key': idempotencyKey!,
    }),
    onSuccess: (value) => {
      setResult(value);
      setSession(null);
      setIdempotencyKey(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.exam(id!) });
      queryClient.invalidateQueries({ queryKey: ['my-attempts'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر إرسال الإجابات'),
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
  const secondsLeft = session?.expiresAt
    ? Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - nowMs) / 1000))
    : null;
  const expired = secondsLeft === 0;

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
    const hasScore = attempt.score !== undefined && attempt.maxScore !== undefined;
    return (
      <div className="mx-auto max-w-4xl animate-fade-up">
        <Link to="/app/results" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted"><ArrowRight className="h-3.5 w-3.5" /> كل الدرجات</Link>
        <Card className="overflow-hidden">
          <div className={`p-7 text-white ${attempt.passed ? 'bg-teal-dark' : hasScore ? 'bg-rose-700' : 'bg-navy'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-white/80">{hasScore ? 'نتيجة الاختبار' : 'تم تسجيل المحاولة'}</p>
                <h1 className="mt-1 text-2xl font-extrabold">{data.exam.title}</h1>
              </div>
              {hasScore && (
                <div className="text-left">
                  <p className="text-4xl font-extrabold">{attempt.percent}%</p>
                  <p className="code-ltr text-sm text-white/80">{attempt.score} / {attempt.maxScore}</p>
                </div>
              )}
            </div>
            <p className="mt-4 text-sm font-bold">
              {hasScore
                ? (attempt.passed
                    ? 'مبروك، نجحت في الاختبار! 🎉'
                    : `لم تصل لدرجة النجاح (${result.passingScore ?? data.exam.passingScore}%). حاول مرة أخرى.`)
                : (result.message ?? 'لا يتم عرض درجات المحاولات المتكررة.')}
            </p>
          </div>
          <div className="space-y-4 p-6">
            <h2 className="font-extrabold text-navy">مراجعة الأسئلة</h2>
            {result.feedback?.length ? (
              result.feedback.map((item, index) => (
                <div key={item.questionId} className="rounded-xl border border-slate-100 p-4">
                  <p className="text-sm font-bold text-navy">{index + 1}. {item.prompt}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">لا توجد مراجعة تفصيلية لهذه المحاولة.</p>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" loading={start.isPending} onClick={() => start.mutate()}>محاولة جديدة</Button>
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
              <h1 className="text-2xl font-extrabold">{data.exam.title}</h1>
              <p className="mt-2 text-sm text-slate-300">{data.exam.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="gold">{data.exam.questionCount} أسئلة</Badge>
              <Badge tone="navy">نجاح: {data.exam.passingScore}%</Badge>
              {data.exam.timeLimitMinutes && <Badge tone="slate">{data.exam.timeLimitMinutes} دقيقة</Badge>}
              {data.exam.maxAttempts !== null && <Badge tone="slate">حد المحاولات: {data.exam.maxAttempts}</Badge>}
            </div>
          </div>
        </div>
        {data.attempts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-4 text-xs">
            <ClipboardList className="h-4 w-4 text-muted" />
            <span className="font-bold text-muted">محاولات سابقة:</span>
            {data.attempts.map((attempt) => (
              <Badge key={attempt.id} tone={attempt.score === undefined ? 'slate' : attempt.passed ? 'teal' : 'rose'}>
                {attempt.score === undefined ? 'محاولة مسجّلة' : `${attempt.score}/${attempt.maxScore} · ${attempt.passed ? 'ناجح' : 'غير ناجح'}`}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {(error || start.isError) && <div className="mb-5"><Alert kind="error">{error || 'تعذّر بدء الاختبار'}</Alert></div>}
      {sessionNotice && !session && <div className="mb-5"><Alert kind="info">{sessionNotice}</Alert></div>}

      {!session && (
        <Card className="mb-6 p-6 text-center">
          <p className="text-sm font-bold text-navy">يبدأ الوقت بعد الضغط على زر البدء، ويُحسب من سيرفر الاختبار.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button loading={start.isPending} onClick={() => start.mutate()}>{sessionNotice ? 'ابدأ جلسة جديدة' : 'ابدأ الاختبار'}</Button>
          </div>
        </Card>
      )}

      {session && !expired && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal/30 bg-teal-light/40 p-4 text-sm">
          <span className="font-bold text-teal-dark">الوقت المتبقي: {secondsLeft === null ? 'غير محدد' : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}</span>
          <Button size="sm" variant="ghost" loading={abandon.isPending} onClick={() => abandon.mutate()}>إلغاء الجلسة</Button>
        </div>
      )}

      {session && expired && (
        <div className="mb-5 rounded-xl border border-rose/30 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          انتهى وقت هذه الجلسة. لم تُسجّل أي محاولة؛ ابدأ جلسة جديدة إن كان مسموحاً لك.
          <div className="mt-3"><Button size="sm" variant="outline" loading={abandon.isPending} onClick={() => abandon.mutate()}>إلغاء الجلسة المنتهية</Button></div>
        </div>
      )}

      {session && (
        <div className="space-y-5">
          {data.questions.map((question, index) => (
            <Card key={question.id} className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center gap-1 rounded-lg bg-navy p-1 text-xs font-bold text-white">{index + 1}</span>
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
                    <label key={option.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${answers[question.id] === option.id ? 'border-teal bg-teal-light/50 font-bold text-teal-dark' : 'border-slate-200 hover:border-slate-200'}`}>
                      <input type="radio" name={question.id} className="accent-teal" checked={answers[question.id] === option.id} onChange={() => setSingle(question.id, option.id)} />
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
                      <label key={option.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${selected ? 'border-teal bg-teal-light/50 font-bold text-teal-dark' : 'border-slate-200 hover:border-slate-200'}`}>
                        <input type="checkbox" className="accent-teal" checked={selected} onChange={() => toggleMulti(question.id, option.id)} />
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
      )}

      {session && (
        <div className="sticky bottom-20 mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-lift">
          <p className="text-xs font-bold text-muted">{answeredCount} من {data.questions.length} سؤال تمت الإجابة عليه</p>
          <Button loading={submit.isPending} disabled={answeredCount === 0 || expired} onClick={() => { if (!submit.isPending && !expired) submit.mutate(); }}>إرسال الإجابات وتصحيحها</Button>
        </div>
      )}
    </div>
  );
}
