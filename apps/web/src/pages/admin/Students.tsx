import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { Badge, Card, EmptyState, Modal, PageHeader, Spinner, TextInput, formatDate, formatMoney } from '../../components/ui';

interface StudentRow {
  id: string; name: string; email: string; phone: string | null; createdAt: string;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  _count: { accessGrants: number; paymentRequests: number; examAttempts: number; lessonProgress: number };
}

function statusTone(status: StudentRow['status']) {
  if (status === 'ACTIVE') return 'teal' as const;
  if (status === 'REJECTED') return 'rose' as const;
  return 'gold' as const;
}
interface StudentDetail {
  student: {
    id: string; name: string; email: string; phone: string | null;
    accessGrants: Array<{ id: string; expiresAt: string | null; product: { name: string } }>;
    paymentRequests: Array<{ id: string; status: string; amountCents: number; reference: string; createdAt: string; product: { name: string } }>;
    examAttempts: Array<{ id: string; score: number; maxScore: number; passed: boolean; exam: { title: string } }>;
    lessonProgress: Array<{ id: string; lesson: { title: string; unit: { course: { title: string } } } }>;
  };
}

export default function Students() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useQuery({ queryKey: queryKeys.adminStudents, queryFn: () => api.get<{ students: StudentRow[] }>('/api/admin/students') });
  const detail = useQuery({
    queryKey: ['admin-student', selectedId],
    queryFn: () => api.get<StudentDetail>(`/api/admin/students/${selectedId}`),
    enabled: !!selectedId,
  });

  const students = (list.data?.students ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="animate-fade-up">
      <PageHeader title="الطلاب" subtitle="استعرض حسابات الطلاب وصلاحياتهم ونتائجهم" />
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <TextInput placeholder="ابحث بالاسم أو البريد..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
      </div>

      {list.isLoading ? <Spinner /> : students.length === 0 ? <EmptyState title="لا يوجد طلاب" description="سيظهر الطلاب المسجلون هنا." icon={<Users />} /> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-muted">
                <tr><th className="p-4">الطالب</th><th className="p-4">التسجيل</th><th className="p-4">صلاحيات</th><th className="p-4">مدفوعات</th><th className="p-4">اختبارات</th><th className="p-4">دروس مكتملة</th><th className="p-4"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-canvas">
                    <td className="p-4"><p className="font-bold text-navy">{student.name}</p><p className="code-ltr text-[11px] text-muted">{student.email}</p></td>
                    <td className="p-4 text-muted">{formatDate(student.createdAt)}</td>
                    <td className="p-4"><Badge tone="teal">{student._count.accessGrants}</Badge></td>
                    <td className="p-4"><Badge tone="slate">{student._count.paymentRequests}</Badge></td>
                    <td className="p-4"><Badge tone="slate">{student._count.examAttempts}</Badge></td>
                    <td className="p-4"><Badge tone="navy">{student._count.lessonProgress}</Badge></td>
                    <td className="p-4"><button onClick={() => setSelectedId(student.id)} className="text-xs font-extrabold text-teal-dark hover:underline">التفاصيل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!selectedId} onClose={() => setSelectedId(null)} title="ملف الطالب" wide>
        {detail.isLoading && <Spinner />}
        {detail.data && (
          <div className="space-y-6">
            <div className="rounded-xl bg-canvas p-4">
              <p className="text-lg font-extrabold text-navy">{detail.data.student.name}</p>
              <p className="code-ltr text-xs text-muted">{detail.data.student.email} · {detail.data.student.phone ?? '—'}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-extrabold text-navy">الصلاحيات</h3>
              <div className="space-y-2">
                {detail.data.student.accessGrants.length === 0 && <p className="text-xs text-muted">لا توجد صلاحيات.</p>}
                {detail.data.student.accessGrants.map((grant) => (
                  <div key={grant.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-xs">
                    <span className="font-bold text-navy">{grant.product.name}</span>
                    <Badge tone={grant.expiresAt ? 'navy' : 'teal'}>{grant.expiresAt ? formatDate(grant.expiresAt) : 'دائم'}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-extrabold text-navy">المدفوعات</h3>
              <div className="space-y-2">
                {detail.data.student.paymentRequests.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-xs">
                    <span>{payment.product.name} · <span className="code-ltr">{payment.reference}</span></span>
                    <span className="flex items-center gap-2"><span className="font-bold">{formatMoney(payment.amountCents)}</span><Badge tone={payment.status === 'APPROVED' ? 'teal' : payment.status === 'REJECTED' ? 'rose' : 'gold'}>{payment.status}</Badge></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-extrabold text-navy">الاختبارات</h3>
                {detail.data.student.examAttempts.map((attempt) => (
                  <p key={attempt.id} className="rounded-lg bg-canvas p-2 text-xs">{attempt.exam.title}: {attempt.score}/{attempt.maxScore}</p>
                ))}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-extrabold text-navy">الدروس المكتملة</h3>
                {detail.data.student.lessonProgress.slice(0, 8).map((progress) => (
                  <p key={progress.id} className="rounded-lg bg-canvas p-2 text-xs">{progress.lesson.unit.course.title} — {progress.lesson.title}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
