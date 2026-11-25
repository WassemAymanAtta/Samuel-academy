import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, XCircle } from 'lucide-react';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, TextArea, formatDate, formatMoney } from '../../components/ui';

interface Payment {
  id: string; amountCents: number; method: string; reference: string; note: string | null; status: string; adminNote: string | null; createdAt: string;
  reviewedAt: string | null; reviewedBy: { name: string } | null;
  user: { id: string; name: string; email: string; phone: string | null };
  product: { id: string; name: string; type: string; durationDays: number | null };
}

export default function Payments() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('PENDING');
  const [selected, setSelected] = useState<Payment | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const payments = useQuery({
    queryKey: [...queryKeys.adminPayments, filter],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/admin/payments?status=${filter}`),
  });

  const review = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'APPROVED' | 'REJECTED'; note: string }) =>
      api.patch<{ granted: boolean }>(`/api/admin/payments/${id}`, { status, adminNote: note || null }),
    onSuccess: (data: { granted: boolean }) => {
      setSuccess(data.granted ? 'تم اعتماد الطلب وتفعيل الوصول تلقائياً.' : 'تم رفض الطلب.');
      setSelected(null); setAdminNote(''); setError('');
      queryClient.invalidateQueries({ queryKey: queryKeys.adminPayments });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر تحديث الطلب'),
  });

  const items = payments.data?.payments ?? [];

  return (
    <div className="animate-fade-up">
      <PageHeader title="طلبات الدفع" subtitle="راجع التحويلات اليدوية واعتمد الصلاحيات — لا يتم التحقق من InstaPay تلقائياً" />
      {success && <div className="mb-5"><Alert kind="success">{success}</Alert></div>}
      {error && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <div className="mb-6 flex flex-wrap gap-2">
        {[['PENDING', 'قيد المراجعة'], ['APPROVED', 'معتمدة'], ['REJECTED', 'مرفوضة'], ['', 'الكل']].map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${filter === value ? 'bg-navy text-white' : 'bg-white text-slate-500 hover:text-navy'}`}>{label}</button>
        ))}
      </div>

      {payments.isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={<CreditCard />} title="لا توجد طلبات في هذا التصنيف" description="ستظهر طلبات الطلاب هنا فور إرسالها." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الطالب</th><th className="p-4">الباقة</th><th className="p-4">المرجع</th><th className="p-4">الوسيلة</th><th className="p-4">المبلغ</th><th className="p-4">التاريخ</th><th className="p-4">الحالة</th><th className="p-4"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((payment) => (
                  <tr key={payment.id} className="hover:bg-canvas">
                    <td className="p-4"><p className="font-bold text-navy">{payment.user.name}</p><p className="code-ltr text-[11px] text-muted">{payment.user.email}</p></td>
                    <td className="p-4">{payment.product.name}</td>
                    <td className="code-ltr p-4 text-xs">{payment.reference}</td>
                    <td className="p-4 text-xs">{payment.method === 'INSTAPAY' ? 'InstaPay' : 'E-wallet'}</td>
                    <td className="p-4 font-extrabold text-navy">{formatMoney(payment.amountCents)}</td>
                    <td className="p-4 text-xs text-muted">{formatDate(payment.createdAt)}</td>
                    <td className="p-4"><Badge tone={payment.status === 'APPROVED' ? 'teal' : payment.status === 'REJECTED' ? 'rose' : 'gold'}>{payment.status === 'APPROVED' ? 'معتمد' : payment.status === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة'}</Badge></td>
                    <td className="p-4"><button onClick={() => { setSelected(payment); setAdminNote(payment.adminNote ?? ''); setError(''); setSuccess(''); }} className="text-xs font-extrabold text-teal-dark hover:underline">مراجعة</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="مراجعة طلب الدفع" wide>
        {selected && (
          <div className="space-y-5">
            <Alert kind="warning">هذا طلب دفع يدوي تجريبي. تأكد من رقم العملية قبل الاعتماد — لا يتحقق النظام من التحويلات تلقائياً.</Alert>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-canvas p-4">
                <p className="text-xs font-bold text-muted">الطالب</p>
                <p className="mt-1 font-extrabold text-navy">{selected.user.name}</p>
                <p className="code-ltr text-xs text-muted">{selected.user.email}</p>
                <p className="code-ltr mt-1 text-xs text-muted">{selected.user.phone ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-canvas p-4">
                <p className="text-xs font-bold text-muted">الباقة والمبلغ</p>
                <p className="mt-1 font-extrabold text-navy">{selected.product.name}</p>
                <p className="text-sm font-extrabold text-teal-dark">{formatMoney(selected.amountCents)}</p>
                <p className="mt-1 text-xs text-muted">{selected.product.durationDays ? `${selected.product.durationDays} يوم` : 'وصول دائم'}</p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p><span className="font-bold text-muted">الوسيلة: </span>{selected.method === 'INSTAPAY' ? 'InstaPay' : 'محفظة إلكترونية'}</p>
                <p><span className="font-bold text-muted">رقم العملية: </span><span className="code-ltr">{selected.reference}</span></p>
                <p><span className="font-bold text-muted">التاريخ: </span>{formatDate(selected.createdAt)}</p>
                <p><span className="font-bold text-muted">الحالة: </span>{selected.status}</p>
              </div>
              {selected.note && <p className="mt-3 rounded-lg bg-gold-light p-3 text-xs text-amber-900">ملاحظة الطالب: {selected.note}</p>}
              {selected.reviewedAt && <p className="mt-2 text-xs text-muted">راجعه {selected.reviewedBy?.name ?? '—'} في {formatDate(selected.reviewedAt)}</p>}
            </div>
            {error && <Alert kind="error">{error}</Alert>}

            {selected.status === 'PENDING' ? (
              <>
                <Field label="ملاحظة الإدارة (اختياري)"><TextArea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="سبب الرفض أو أي ملاحظة..." /></Field>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button variant="danger" loading={review.isPending} onClick={() => review.mutate({ id: selected.id, status: 'REJECTED', note: adminNote })}><XCircle className="h-4 w-4" /> رفض الطلب</Button>
                  <Button variant="teal" loading={review.isPending} onClick={() => review.mutate({ id: selected.id, status: 'APPROVED', note: adminNote })}><CheckCircle2 className="h-4 w-4" /> اعتماد ومنح الوصول</Button>
                </div>
              </>
            ) : (
              <Alert kind="info">تمت مراجعة هذا الطلب مسبقاً ولا يمكن تغيير قراره.</Alert>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
