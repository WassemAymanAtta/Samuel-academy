import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput, formatMoney } from '../../components/ui';
import type { ContentTree } from './Content';

interface Product {
  id: string; name: string; description: string | null; type: string; priceCents: number; currency: string; durationDays: number | null;
  isActive: boolean; subjectId: string | null; courseId: string | null; unitId: string | null; lessonId: string | null; examId: string | null;
  subject?: { name: string } | null; course?: { title: string } | null; unit?: { title: string } | null; lesson?: { title: string } | null; exam?: { title: string } | null;
}
interface ProductForm {
  name: string; description: string; type: string; priceCents: number; currency: string; durationDays: number | null;
  subjectId: string; courseId: string; unitId: string; lessonId: string; examId: string; isActive: boolean;
}
const blank: ProductForm = { name: '', description: '', type: 'MONTHLY', priceCents: 9900, currency: 'EGP', durationDays: 30, subjectId: '', courseId: '', unitId: '', lessonId: '', examId: '', isActive: true };
const typeLabels: Record<string, string> = { MONTHLY: 'اشتراك شهري', TERM: 'اشتراك فصلي', UNIT: 'وحدة', LESSON: 'درس', EXAM_PACKAGE: 'باقة أسئلة' };

export default function Products() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ form: ProductForm; id?: string } | null>(null);
  const [error, setError] = useState('');
  const products = useQuery({ queryKey: queryKeys.adminProducts, queryFn: () => api.get<{ products: Product[] }>('/api/admin/products') });
  const content = useQuery({ queryKey: queryKeys.adminContent, queryFn: () => api.get<ContentTree>('/api/admin/content') });
  const exams = useQuery({ queryKey: queryKeys.adminExams, queryFn: () => api.get<{ exams: Array<{ id: string; title: string }> }>('/api/admin/exams') });

  const subjects = content.data?.subjects ?? [];
  const courses = subjects.flatMap((s) => s.courses);
  const units = courses.flatMap((c) => c.units);
  const lessons = units.flatMap((u) => u.lessons);

  const save = useMutation({
    mutationFn: ({ form, id }: { form: ProductForm; id?: string }) => {
      const payload = {
        ...form,
        priceCents: Number(form.priceCents),
        durationDays: form.durationDays === null ? null : Number(form.durationDays),
        subjectId: form.subjectId || null, courseId: form.courseId || null, unitId: form.unitId || null,
        lessonId: form.lessonId || null, examId: form.examId || null, description: form.description || null,
      };
      return id ? api.put(`/api/admin/products/${id}`, payload) : api.post('/api/admin/products', payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts }); setEditing(null); setError(''); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر حفظ الباقة'),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/products/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts }),
  });

  function open(product?: Product) {
    setError('');
    setEditing({
      id: product?.id,
      form: product ? {
        name: product.name, description: product.description ?? '', type: product.type, priceCents: product.priceCents,
        currency: product.currency, durationDays: product.durationDays, subjectId: product.subjectId ?? '', courseId: product.courseId ?? '',
        unitId: product.unitId ?? '', lessonId: product.lessonId ?? '', examId: product.examId ?? '', isActive: product.isActive,
      } : { ...blank },
    });
  }

  if (products.isLoading) return <Spinner />;

  return (
    <div className="animate-fade-up">
      <PageHeader title="الباقات والأسعار" subtitle="حدّث الأسعار بالجنيه المصري ومدد الوصول — التغييرات تنعكس فوراً على واجهة الطالب" action={<Button onClick={() => open()}><Plus className="h-4 w-4" /> باقة جديدة</Button>} />
      {error && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <Card className="overflow-hidden">
        {(products.data?.products ?? []).length === 0 && <EmptyState icon={<Tag />} title="لا توجد باقات" description="أنشئ باقة اشتراك أو وحدة أو درس." />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الباقة</th><th className="p-4">النوع</th><th className="p-4">السعر</th><th className="p-4">المدة</th><th className="p-4">المحتوى المرتبط</th><th className="p-4">الحالة</th><th className="p-4">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(products.data?.products ?? []).map((product) => (
                <tr key={product.id} className="hover:bg-canvas">
                  <td className="p-4"><p className="font-bold text-navy">{product.name}</p><p className="text-[11px] text-muted">{product.description}</p></td>
                  <td className="p-4"><Badge tone="navy">{typeLabels[product.type] ?? product.type}</Badge></td>
                  <td className="p-4 font-extrabold text-teal-dark">{formatMoney(product.priceCents, product.currency)}</td>
                  <td className="p-4 text-muted">{product.durationDays ? `${product.durationDays} يوم` : 'دائم'}</td>
                  <td className="p-4 text-xs text-muted">{product.subject?.name ?? product.course?.title ?? product.unit?.title ?? product.lesson?.title ?? product.exam?.title ?? 'كل المحتوى'}</td>
                  <td className="p-4">{product.isActive ? <Badge tone="teal">نشطة</Badge> : <Badge tone="slate">مؤرشفة</Badge>}</td>
                  <td className="p-4"><div className="flex gap-1">
                    <button onClick={() => open(product)} className="rounded-lg p-2 text-teal-dark hover:bg-teal-light"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => { if (confirm('إيقاف الباقة؟')) archive.mutate(product.id); }} className="rounded-lg px-2 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">إيقاف</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? 'تعديل' : 'إنشاء'} باقة`} wide>
        {editing && (
          <form onSubmit={(event) => { event.preventDefault(); save.mutate(editing); }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم الباقة"><TextInput required value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} /></Field>
              <Field label="النوع"><Select value={editing.form.type} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, type: e.target.value } })}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            </div>
            <Field label="الوصف"><TextArea rows={2} value={editing.form.description} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, description: e.target.value } })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="السعر (بالجنيه)"><TextInput type="number" min={1} step="0.5" value={editing.form.priceCents / 100} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, priceCents: Math.round(Number(e.target.value) * 100) } })} /></Field>
              <Field label="العملة"><TextInput dir="ltr" className="code-ltr text-left" maxLength={3} value={editing.form.currency} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, currency: e.target.value.toUpperCase() } })} /></Field>
              <Field label="مدة الوصول (أيام)" hint="اتركها فارغة للوصول الدائم"><TextInput type="number" min={1} value={editing.form.durationDays ?? ''} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, durationDays: e.target.value ? Number(e.target.value) : null } })} /></Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {['MONTHLY', 'TERM'].includes(editing.form.type) && <>
                <Field label="مادة (اختياري)"><Select value={editing.form.subjectId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, subjectId: e.target.value, courseId: '' } })}><option value="">كل المواد</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="كورس (اختياري)"><Select value={editing.form.courseId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, courseId: e.target.value, subjectId: '' } })}><option value="">كل الكورسات</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
              </>}
              {editing.form.type === 'UNIT' && <Field label="الوحدة"><Select required value={editing.form.unitId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, unitId: e.target.value } })}><option value="">اختر وحدة</option>{units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}</Select></Field>}
              {editing.form.type === 'LESSON' && <Field label="الدرس"><Select required value={editing.form.lessonId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, lessonId: e.target.value } })}><option value="">اختر درساً</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select></Field>}
              {editing.form.type === 'EXAM_PACKAGE' && <Field label="الاختبار"><Select required value={editing.form.examId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, examId: e.target.value } })}><option value="">اختر اختباراً</option>{(exams.data?.exams ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</Select></Field>}
            </div>
            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-teal" checked={editing.form.isActive} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, isActive: e.target.checked } })} /> الباقة نشطة ومتاحة للشراء</label>

            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button><Button loading={save.isPending}>حفظ</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
