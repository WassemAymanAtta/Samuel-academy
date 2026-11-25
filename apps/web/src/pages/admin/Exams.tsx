import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput } from '../../components/ui';
import type { ContentTree } from './Content';

interface ExamRow {
  id: string; title: string; description: string | null; passingScore: number;
  timeLimitMinutes: number | null; maxAttempts: number | null; isPublished: boolean;
  unit?: { title: string; course: { title: string } } | null; lesson?: { title: string } | null;
  _count: { questions: number; attempts: number };
}
interface Question {
  id: string; type: string; prompt: string; explanation: string | null; expectedAnswer: string | null; points: number; sortOrder: number;
  options: Array<{ id: string; text: string; isCorrect: boolean; sortOrder: number }>;
}
interface ExamDetail { exam: ExamRow & { questions: Question[] } }

const typeLabels: Record<string, string> = { MCQ: 'اختيار من متعدد', TRUE_FALSE: 'صح / خطأ', MULTIPLE_SELECT: 'اختيار متعدد', SHORT_ANSWER: 'إجابة قصيرة' };

interface ExamForm { unitId: string; lessonId: string; title: string; description: string; passingScore: number; timeLimitMinutes: number; maxAttempts: number; isPublished: boolean }
interface QuestionForm { examId: string; type: string; prompt: string; explanation: string; expectedAnswer: string; points: number; sortOrder: number; options: Array<{ text: string; isCorrect: boolean; sortOrder: number }> }

const blankExam: ExamForm = { unitId: '', lessonId: '', title: '', description: '', passingScore: 60, timeLimitMinutes: 20, maxAttempts: 0, isPublished: true };
const blankQuestion = (examId: string): QuestionForm => ({ examId, type: 'MCQ', prompt: '', explanation: '', expectedAnswer: '', points: 1, sortOrder: 0, options: [{ text: '', isCorrect: true, sortOrder: 1 }, { text: '', isCorrect: false, sortOrder: 2 }] });

export default function Exams() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [examForm, setExamForm] = useState<{ form: ExamForm; id?: string } | null>(null);
  const [questionForm, setQuestionForm] = useState<{ form: QuestionForm; id?: string } | null>(null);
  const [error, setError] = useState('');

  const exams = useQuery({ queryKey: queryKeys.adminExams, queryFn: () => api.get<{ exams: ExamRow[] }>('/api/admin/exams') });
  const detail = useQuery({
    queryKey: ['admin-exam', selectedId],
    queryFn: () => api.get<ExamDetail>(`/api/admin/exams/${selectedId}`),
    enabled: !!selectedId,
  });
  const content = useQuery({ queryKey: queryKeys.adminContent, queryFn: () => api.get<ContentTree>('/api/admin/content') });

  const units = (content.data?.subjects ?? []).flatMap((s) => s.courses.flatMap((c) => c.units.map((u) => ({ ...u, courseTitle: c.title }))));
  const lessons = units.flatMap((u) => u.lessons.map((l) => ({ ...l, unitTitle: u.title })));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminExams });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ['admin-exam', selectedId] });
  };

  const saveExam = useMutation({
    mutationFn: ({ form, id }: { form: ExamForm; id?: string }) => {
      const payload = {
        ...form,
        unitId: form.unitId || null,
        lessonId: form.lessonId || null,
        description: form.description || null,
        timeLimitMinutes: form.timeLimitMinutes || null,
        maxAttempts: form.maxAttempts || null,
      };
      return id ? api.put(`/api/admin/exams/${id}`, payload) : api.post('/api/admin/exams', payload);
    },
    onSuccess: () => { invalidate(); setExamForm(null); setError(''); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر حفظ الاختبار'),
  });

  const saveQuestion = useMutation({
    mutationFn: ({ form, id }: { form: QuestionForm; id?: string }) =>
      id ? api.put(`/api/admin/questions/${id}`, form) : api.post('/api/admin/questions', form),
    onSuccess: () => { invalidate(); setQuestionForm(null); setError(''); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر حفظ السؤال'),
  });

  const removeQuestion = useMutation({ mutationFn: (id: string) => api.delete(`/api/admin/questions/${id}`), onSuccess: invalidate });
  const removeExam = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/exams/${id}`),
    onSuccess: () => { setSelectedId(null); invalidate(); },
  });

  function openExam(exam?: ExamRow) {
    setError('');
    setExamForm({
      id: exam?.id,
      form: exam ? {
        unitId: exam.unit ? units.find((u) => u.title === exam.unit!.title)?.id ?? '' : '',
        lessonId: exam.lesson ? lessons.find((l) => l.title === exam.lesson!.title)?.id ?? '' : '',
        title: exam.title, description: exam.description ?? '', passingScore: exam.passingScore,
        timeLimitMinutes: exam.timeLimitMinutes ?? 20, maxAttempts: exam.maxAttempts ?? 0,
        isPublished: exam.isPublished,
      } : { ...blankExam, unitId: units[0]?.id ?? '' },
    });
  }

  function openQuestion(question?: Question) {
    if (!selectedId) return;
    setError('');
    setQuestionForm({
      id: question?.id,
      form: question ? {
        examId: selectedId, type: question.type, prompt: question.prompt, explanation: question.explanation ?? '',
        expectedAnswer: question.expectedAnswer ?? '', points: question.points, sortOrder: question.sortOrder,
        options: question.options.length ? question.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, sortOrder: o.sortOrder })) : blankQuestion(selectedId).options,
      } : blankQuestion(selectedId),
    });
  }

  if (exams.isLoading) return <Spinner />;

  const selected = detail.data?.exam;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="الأسئلة والاختبارات"
        subtitle="أنشئ اختبارات، أضف أسئلة متنوعة، وراجع محاولات الطلاب"
        action={<Button onClick={() => openExam()}><Plus className="h-4 w-4" /> اختبار جديد</Button>}
      />
      {error && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-1">
          <Card className="divide-y divide-slate-100">
            {(exams.data?.exams ?? []).length === 0 && <EmptyState icon={<ClipboardList />} title="لا توجد اختبارات" description="أنشئ أول اختبار للطلاب." />}
            {(exams.data?.exams ?? []).map((exam) => (
              <button key={exam.id} onClick={() => setSelectedId(exam.id)} className={`w-full p-4 text-right transition ${selectedId === exam.id ? 'bg-teal-light/60' : 'hover:bg-canvas'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-extrabold text-navy">{exam.title}</p>
                  {exam.isPublished ? <Badge tone="teal">منشور</Badge> : <Badge tone="slate">مسودة</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">{exam.unit?.course.title ?? exam.lesson?.title ?? '—'}</p>
                <div className="mt-2 flex gap-2 text-[11px] text-muted"><span>{exam._count.questions} أسئلة</span><span>·</span><span>{exam._count.attempts} محاولات</span></div>
              </button>
            ))}
          </Card>
        </section>

        <section className="xl:col-span-2">
          {!selectedId ? (
            <Card className="p-10 text-center"><p className="text-sm text-muted">اختر اختباراً من القائمة لعرض أسئلته.</p></Card>
          ) : detail.isLoading ? <Spinner /> : !selected ? <div className="text-sm text-rose-600">تعذّر تحميل الاختبار.</div> : (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
                <div>
                  <h2 className="text-lg font-extrabold text-navy">{selected.title}</h2>
                  <p className="mt-1 text-xs text-muted">{selected.description ?? 'لا يوجد وصف'} · درجة النجاح {selected.passingScore}%</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openExam(selected)}><Pencil className="h-3.5 w-3.5" /> تعديل</Button>
                  <Button size="sm" variant="danger" onClick={() => { if (confirm('حذف الاختبار وكل أسئلته؟')) removeExam.mutate(selected.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {selected.questions.length === 0 && <p className="p-6 text-sm text-muted">لا توجد أسئلة بعد.</p>}
                {selected.questions.map((question, index) => (
                  <div key={question.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><Badge tone="navy">{index + 1}</Badge><Badge tone="slate">{typeLabels[question.type] ?? question.type}</Badge><span className="text-xs text-muted">{question.points} نقطة</span></div>
                        <p className="mt-2 text-sm font-bold text-navy">{question.prompt}</p>
                        {question.options.map((option) => (
                          <p key={option.id} className={`mt-1 text-xs ${option.isCorrect ? 'font-extrabold text-teal-dark' : 'text-muted'}`}>{option.isCorrect ? '✓ ' : '• '}{option.text}</p>
                        ))}
                        {question.expectedAnswer && <p className="mt-1 text-xs font-bold text-teal-dark">الإجابة النموذجية: {question.expectedAnswer}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openQuestion(question)} className="rounded-lg p-2 text-teal-dark hover:bg-teal-light"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => { if (confirm('حذف السؤال؟')) removeQuestion.mutate(question.id); }} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 p-5"><Button variant="teal" size="sm" onClick={() => openQuestion()}><Plus className="h-4 w-4" /> سؤال جديد</Button></div>
            </Card>
          )}
        </section>
      </div>

      <Modal open={!!examForm} onClose={() => setExamForm(null)} title={`${examForm?.id ? 'تعديل' : 'إنشاء'} اختبار`}>
        {examForm && (
          <form onSubmit={(event) => { event.preventDefault(); saveExam.mutate(examForm); }} className="space-y-4">
            <Field label="عنوان الاختبار"><TextInput required value={examForm.form.title} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, title: e.target.value } })} /></Field>
            <Field label="الوصف"><TextArea rows={2} value={examForm.form.description} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, description: e.target.value } })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الوحدة"><Select value={examForm.form.unitId} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, unitId: e.target.value, lessonId: '' } })}><option value="">— لا شيء —</option>{units.map((u) => <option key={u.id} value={u.id}>{u.courseTitle} — {u.title}</option>)}</Select></Field>
              <Field label="أو درس"><Select value={examForm.form.lessonId} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, lessonId: e.target.value, unitId: '' } })}><option value="">— لا شيء —</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="درجة النجاح %"><TextInput type="number" min={0} max={100} value={examForm.form.passingScore} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, passingScore: Number(e.target.value) } })} /></Field>
              <Field label="الوقت (دقائق)"><TextInput type="number" min={1} value={examForm.form.timeLimitMinutes} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, timeLimitMinutes: Number(e.target.value) } })} /></Field>
              <Field label="حد المحاولات" hint="0 أو فارغ = غير محدود"><TextInput type="number" min={0} value={examForm.form.maxAttempts} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, maxAttempts: Number(e.target.value) } })} /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-teal" checked={examForm.form.isPublished} onChange={(e) => setExamForm({ ...examForm, form: { ...examForm.form, isPublished: e.target.checked } })} /> منشور</label>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setExamForm(null)}>إلغاء</Button><Button loading={saveExam.isPending}>حفظ</Button></div>
          </form>
        )}
      </Modal>

      <Modal open={!!questionForm} onClose={() => setQuestionForm(null)} title={`${questionForm?.id ? 'تعديل' : 'إضافة'} سؤال`} wide>
        {questionForm && (
          <form onSubmit={(event) => { event.preventDefault(); saveQuestion.mutate(questionForm); }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نوع السؤال"><Select value={questionForm.form.type} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, type: e.target.value } })}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
              <Field label="النقاط"><TextInput type="number" min={1} max={20} value={questionForm.form.points} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, points: Number(e.target.value) } })} /></Field>
            </div>
            <Field label="نص السؤال"><TextArea rows={2} required value={questionForm.form.prompt} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, prompt: e.target.value } })} /></Field>
            <Field label="الترتيب"><TextInput type="number" value={questionForm.form.sortOrder} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, sortOrder: Number(e.target.value) } })} /></Field>

            {questionForm.form.type === 'SHORT_ANSWER' ? (
              <Field label="الإجابة النموذجية" hint="يمكن كتابة أكثر من إجابة separated by |"><TextInput value={questionForm.form.expectedAnswer} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, expectedAnswer: e.target.value } })} /></Field>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between"><label className="mb-0">الخيارات</label><Button type="button" size="sm" variant="ghost" onClick={() => setQuestionForm({ ...questionForm, form: { ...questionForm.form, options: [...questionForm.form.options, { text: '', isCorrect: false, sortOrder: questionForm.form.options.length + 1 }] } })}><Plus className="h-3.5 w-3.5" /> خيار</Button></div>
                <div className="space-y-2">
                  {questionForm.form.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-teal" checked={option.isCorrect} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, options: questionForm.form.options.map((o, i) => i === index ? { ...o, isCorrect: e.target.checked } : o) } })} title="إجابة صحيحة" />
                      <TextInput value={option.text} placeholder={`الخيار ${index + 1}`} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, options: questionForm.form.options.map((o, i) => i === index ? { ...o, text: e.target.value } : o) } })} />
                      <button type="button" onClick={() => setQuestionForm({ ...questionForm, form: { ...questionForm.form, options: questionForm.form.options.filter((_, i) => i !== index) } })} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">فعّل مربع الاختيار بجانب الإجابة أو الإجابات الصحيحة.</p>
              </div>
            )}
            <Field label="شرح الإجابة (اختياري)"><TextArea rows={2} value={questionForm.form.explanation} onChange={(e) => setQuestionForm({ ...questionForm, form: { ...questionForm.form, explanation: e.target.value } })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setQuestionForm(null)}>إلغاء</Button><Button loading={saveQuestion.isPending}>حفظ السؤال</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
