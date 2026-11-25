import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, CreditCard, Package, XCircle } from 'lucide-react';
import { usePublicConfig } from '../../hooks/usePublicConfig';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput, formatDate, formatMoney } from '../../components/ui';

interface Product {
  id: string; name: string; description: string | null; type: string; priceCents: number; durationDays: number | null;
  subject?: { name: string } | null; course?: { title: string } | null; unit?: { title: string } | null; lesson?: { title: string } | null; exam?: { title: string } | null;
}
interface Payment {
  id: string; amountCents: number; method: string; reference: string; note: string | null; status: string; createdAt: string;
  product: Product; accessGrant: { id: string; expiresAt: string | null } | null;
}
interface Grant { id: string; product: Product; grantedAt: string; expiresAt: string | null }
const typeLabels: Record<string, string> = { MONTHLY: 'اشتراك شهري', TERM: 'اشتراك فصلي', UNIT: 'وحدة', LESSON: 'درس', EXAM_PACKAGE: 'باقة أسئلة' };
const statusLabels: Record<string, string> = { PENDING: 'قيد المراجعة', APPROVED: 'معتمد', REJECTED: 'مرفوض' };
const methodLabels: Record<string, string> = { INSTAPAY: 'InstaPay', EWALLET: 'محفظة إلكترونية' };

export default function Purchases() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [method, setMethod] = useState<'INSTAPAY' | 'EWALLET'>('INSTAPAY');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const products = useQuery({ queryKey: queryKeys.products, queryFn: () => api.get<{ products: Product[] }>('/api/products') });
  const payments = useQuery({ queryKey: queryKeys.payments, queryFn: () => api.get<{ payments: Payment[] }>('/api/me/payments') });
  const config = usePublicConfig();
  const access = useQuery({ queryKey: ['my-access'], queryFn: () => api.get<{ grants: Grant[] }>('/api/student/me/access') });

  const submit = useMutation({
    mutationFn: () => api.post('/api/payments', { productId: selected!.id, method, reference, note: note || undefined }),
    onSuccess: () => {
      setSuccess('تم إرسال طلب الدفع. سيظهر هنا فور مراجعة الإدارة.');
      setError(''); setSelected(null); setReference(''); setNote('');
      queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      queryClient.invalidateQueries({ queryKey: ['my-access'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر إرسال الطلب'),
  });

  function open(product: Product) {
    setSelected(product); setError(''); setSuccess(''); setReference(''); setNote('');
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || submit.isPending) return;
    submit.mutate();
  }

  if (products.isLoading || payments.isLoading) return <Spinner />;

  const scopeLabel = (product: Product) =>
    product.subject?.name ?? product.course?.title ?? product.unit?.title ?? product.lesson?.title ?? product.exam?.title ?? 'كل المحتوى';

  return (
    <div className="animate-fade-up">
      <PageHeader title="الباقات والمشتريات" subtitle="اختر ما يناسبك، أرسل بيانات التحويل، وستفعّل الصلاحية بعد مراجعة الإدارة" />

      {success && <div className="mb-5"><Alert kind="success">{success}</Alert></div>}
      {config.data?.demoMode && (
        <div className="mb-6"><Alert kind="warning">
          <strong className="ml-1">DEMO:</strong> جميع الأسعار وأرقام الدفع أدناه تجريبية. لا تحوّل أي مبلغ حقيقي. لا يتم التحقق من InstaPay تلقائياً في هذه النسخة.
        </Alert></div>
      )}

      <div className="grid gap-7 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold text-navy"><Package className="h-5 w-5 text-teal" /> الباقات المتاحة</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {(products.data?.products ?? []).map((product, index) => (
              <Card key={product.id} className={`flex h-full flex-col p-5 ${index === 0 ? 'ring-2 ring-gold' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <Badge tone={index === 0 ? 'gold' : 'navy'}>{typeLabels[product.type] ?? product.type}</Badge>
                  {index === 0 && <Badge tone="gold">الأكثر شمولاً</Badge>}
                </div>
                <h3 className="mt-4 font-extrabold text-navy">{product.name}</h3>
                <p className="mt-1 text-xs text-muted">{product.description}</p>
                <p className="mt-2 text-xs font-bold text-teal-dark">{scopeLabel(product)}</p>
                <div className="mt-auto pt-5">
                  <div className="flex items-end justify-between gap-2">
                    <div><p className="text-2xl font-extrabold text-navy">{formatMoney(product.priceCents)}</p><p className="text-[11px] text-muted">{product.durationDays ? `صالحة ${product.durationDays} يوماً` : 'متاحة بشكل دائم'}</p></div>
                    <Button size="sm" onClick={() => open(product)}>اشترِ الآن</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {(products.data?.products ?? []).length === 0 && <EmptyState title="لا توجد باقات متاحة" />}
        </section>

        <div className="space-y-7">
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold text-navy"><CreditCard className="h-5 w-5 text-teal" /> طلباتي</h2>
            <Card className="divide-y divide-slate-100">
              {(payments.data?.payments ?? []).length === 0 && <p className="p-5 text-sm text-muted">لا توجد طلبات بعد.</p>}
              {(payments.data?.payments ?? []).map((payment) => (
                <div key={payment.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-navy">{payment.product.name}</p>
                    <Badge tone={payment.status === 'APPROVED' ? 'teal' : payment.status === 'REJECTED' ? 'rose' : 'gold'}>{statusLabels[payment.status]}</Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted">
                    <p>{formatMoney(payment.amountCents)} · {methodLabels[payment.method]}</p>
                    <p className="code-ltr">Ref: {payment.reference}</p>
                    <p>{formatDate(payment.createdAt)}</p>
                    {payment.accessGrant && <p className="font-bold text-teal-dark">تم تفعيل الوصول {payment.accessGrant.expiresAt ? `حتى ${formatDate(payment.accessGrant.expiresAt)}` : 'بشكل دائم'}</p>}
                  </div>
                </div>
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-extrabold text-navy">وصولي الحالي</h2>
            <Card className="divide-y divide-slate-100">
              {(access.data?.grants ?? []).length === 0 && <p className="p-5 text-sm text-muted">لا توجد صلاحيات مفعّلة بعد.</p>}
              {(access.data?.grants ?? []).map((grant) => (
                <div key={grant.id} className="flex items-center justify-between gap-3 p-4">
                  <div><p className="text-sm font-bold text-navy">{grant.product.name}</p><p className="text-xs text-muted">{formatDate(grant.grantedAt)}</p></div>
                  <Badge tone={grant.expiresAt ? 'navy' : 'teal'}>{grant.expiresAt ? `حتى ${formatDate(grant.expiresAt)}` : 'دائم'}</Badge>
                </div>
              ))}
            </Card>
          </section>
        </div>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="إرسال طلب دفع">
        {selected && (
          <form onSubmit={send} className="space-y-5">
            <div className="rounded-xl bg-canvas p-4">
              <div className="flex items-center justify-between"><p className="font-extrabold text-navy">{selected.name}</p><p className="text-lg font-extrabold text-teal-dark">{formatMoney(selected.priceCents)}</p></div>
              <p className="mt-1 text-xs text-muted">{selected.durationDays ? `مدة الوصول: ${selected.durationDays} يوماً` : 'الوصول دائم بعد الاعتماد'}</p>
            </div>

            {config.data?.demoMode && (
              <Alert kind="warning">
                <p className="font-extrabold">بيانات تجريبية للدفع — DEMO</p>
                <p className="code-ltr mt-1 text-xs">{method === 'INSTAPAY' ? config.data.paymentDetails.instapay : config.data.paymentDetails.ewallet}</p>
                <p className="mt-2 text-xs">لا ترسل أموالاً حقيقية. المراجعة يدوية وليست آلية.</p>
              </Alert>
            )}

            <Field label="وسيلة الدفع">
              <Select value={method} onChange={(e) => setMethod(e.target.value as 'INSTAPAY' | 'EWALLET')}>
                <option value="INSTAPAY">InstaPay</option>
                <option value="EWALLET">محفظة إلكترونية (E-wallet)</option>
              </Select>
            </Field>
            <Field label="رقم العملية / المرجع" hint="اكتب الرقم الذي يظهر لك بعد إتمام التحويل التجريبي.">
              <TextInput required minLength={3} maxLength={100} dir="ltr" className="code-ltr text-left" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DEMO-REF-12345" />
            </Field>
            <Field label="ملاحظة (اختياري)">
              <TextArea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="أي تفاصيل تريد إضافتها للإدارة..." />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>إلغاء</Button>
              <Button type="submit" loading={submit.isPending}>إرسال الطلب</Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 text-xs text-muted"><Clock3 className="h-5 w-5 text-gold" /> الطلبات تُراجع يدوياً من الإدارة</div>
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 text-xs text-muted"><CheckCircle2 className="h-5 w-5 text-teal" /> عند الاعتماد يُفعّل الوصول تلقائياً</div>
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 text-xs text-muted"><XCircle className="h-5 w-5 text-rose-500" /> يمكن رفض الطلب مع سبب واضح</div>
      </div>
    </div>
  );
}
