import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, UserCheck, XCircle } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner, formatDate } from '../../components/ui';

type Status = 'PENDING' | 'ACTIVE' | 'REJECTED';

interface StudentRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  status: Status;
}

function statusBadge(status: Status) {
  if (status === 'ACTIVE') return <Badge tone="teal">Active · نشط</Badge>;
  if (status === 'REJECTED') return <Badge tone="rose">Rejected · مرفوض</Badge>;
  return <Badge tone="gold">Pending · قيد المراجعة</Badge>;
}

export default function PendingStudents() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Extract<Status, 'PENDING' | 'REJECTED'>>('PENDING');
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: [...queryKeys.adminStudents, 'review', tab],
    queryFn: () => api.get<{ students: StudentRow[] }>(`/api/admin/students?status=${tab}`),
  });

  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) =>
      api.patch(`/api/admin/students/${id}/status`, { status }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: queryKeys.adminStudents });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر تحديث حالة الطالب'),
  });

  const students = list.data?.students ?? [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="طلبات التسجيل"
        subtitle="راجع حسابات الطلاب الجديدة واعتمدها أو ارفضها قبل السماح لهم بالدخول"
      />

      {error && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setTab('PENDING')}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === 'PENDING' ? 'bg-gold text-navy' : 'bg-white text-slate-500 hover:text-navy'}`}
        >
          قيد المراجعة
          {tab === 'PENDING' && list.data && <span className="mr-2 rounded-md bg-white/40 px-1.5 text-[10px]">{students.length}</span>}
        </button>
        <button
          onClick={() => setTab('REJECTED')}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === 'REJECTED' ? 'bg-rose-600 text-white' : 'bg-white text-slate-500 hover:text-navy'}`}
        >
          المرفوضون
          {tab === 'REJECTED' && list.data && <span className="mr-2 rounded-md bg-white/20 px-1.5 text-[10px]">{students.length}</span>}
        </button>
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : students.length === 0 ? (
        <EmptyState
          title={tab === 'PENDING' ? 'لا توجد طلبات معلّقة' : 'لا يوجد طلاب مرفوضون'}
          description={tab === 'PENDING' ? 'ستظهر طلبات التسجيل الجديدة هنا.' : 'سيظهر الطلاب المرفوضون هنا للمراجعة.'}
          icon={<UserCheck />}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-muted">
                <tr>
                  <th className="p-4">الطالب</th>
                  <th className="p-4">البريد الإلكتروني</th>
                  <th className="p-4">تاريخ التسجيل</th>
                  <th className="p-4">حالة الحساب</th>
                  <th className="p-4">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-canvas">
                    <td className="p-4">
                      <p className="font-bold text-navy">{student.name}</p>
                      {student.phone && <p className="code-ltr text-[11px] text-muted" dir="ltr">{student.phone}</p>}
                    </td>
                    <td className="code-ltr p-4 text-xs text-muted" dir="ltr">{student.email}</td>
                    <td className="p-4 text-muted">{formatDate(student.createdAt)}</td>
                    <td className="p-4">{statusBadge(student.status)}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="teal"
                          loading={review.isPending && review.variables?.id === student.id && review.variables?.status === 'ACTIVE'}
                          onClick={() => review.mutate({ id: student.id, status: 'ACTIVE' })}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve · قبول
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={review.isPending && review.variables?.id === student.id && review.variables?.status === 'REJECTED'}
                          onClick={() => review.mutate({ id: student.id, status: 'REJECTED' })}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject · رفض
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
