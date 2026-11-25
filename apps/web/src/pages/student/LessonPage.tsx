import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ClipboardList, Download, ExternalLink, FileText, Lock, Maximize2, Minimize2, PlayCircle, Video, Volume2 } from 'lucide-react';
import { ApiError, api, privateFileUrl, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, Spinner, formatMoney } from '../../components/ui';

interface PdfFileMeta {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
}

interface LessonData {
  lesson: {
    id: string; title: string; description: string | null; videoUrl: string | null;
    mediaFile: PdfFileMeta | null; mediaTitle: string | null;
    pdfUrl: string | null; pdfTitle: string | null;
    pdfFile: PdfFileMeta | null;
    durationMinutes: number | null;
    unit: { title: string; course: { id: string; title: string; subject: { name: string } } };
    exams: Array<{ id: string; title: string; passingScore: number }>;
  };
  unlocked: boolean;
  completed: boolean;
}

interface LockedResponse {
  lesson: { id: string; title: string; description: string | null };
  suggestions: Array<{ id: string; name: string; type: string; priceCents: number }>;
}

function PdfLink({ href, title, sizeBytes, external = false }: { href: string; title: string; sizeBytes?: number; external?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-teal">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><FileText className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-navy">{title}</p>
        <p className="text-xs text-muted">
          {external ? 'رابط خارجي · يُفتح في نافذة جديدة' : 'ملف خاص · يُفتح في نافذة جديدة'}
          {sizeBytes ? ` · ${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
        </p>
      </div>
      <ExternalLink className="mr-auto h-4 w-4 text-muted" />
    </a>
  );
}

function MediaLink({ file, title }: { file: PdfFileMeta; title: string }) {
  const isAudio = file.mimeType.startsWith('audio');
  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3">
      <a href={privateFileUrl(file.id)} target="_blank" rel="noreferrer" className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-light text-teal-dark">
          {isAudio ? <Volume2 className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-navy">{title}</p>
          <p className="text-xs text-muted">ملف خاص · {(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</p>
        </div>
      </a>
      <a href={privateFileUrl(file.id)} download className="mt-3 flex items-center justify-center gap-2 text-xs font-extrabold text-teal-dark hover:underline">
        <Download className="h-3.5 w-3.5" /> تنزيل {isAudio ? 'الصوت' : 'الفيديو'}
      </a>
    </div>
  );
}

export default function LessonPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [theater, setTheater] = useState(false);

  // Theater mode fills the viewport even where the Fullscreen API is unavailable.
  useEffect(() => {
    if (!theater) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTheater(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [theater]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.lesson(id!),
    queryFn: () => api.get<LessonData>(`/api/catalog/lessons/${id}`),
    enabled: !!id,
  });

  const locked = error instanceof ApiError && error.code === 'CONTENT_LOCKED' ? (error.body as LockedResponse) : null;

  const complete = useMutation({
    mutationFn: () => api.post(`/api/student/lessons/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lesson(id!) });
      queryClient.invalidateQueries({ queryKey: ['course'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      setMessage('تم تسجيل إكمال الدرس بنجاح');
    },
  });

  const undo = useMutation({
    mutationFn: () => api.delete(`/api/student/lessons/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lesson(id!) });
      queryClient.invalidateQueries({ queryKey: ['course'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      setMessage('تمت إزالة علامة الإكمال');
    },
  });

  if (isLoading) return <Spinner />;

  if (locked) {
    return (
      <div className="mx-auto max-w-3xl animate-fade-up">
        <Link to="/app/catalog" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted"><ArrowRight className="h-3.5 w-3.5" /> العودة للمواد</Link>
        <Card className="p-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-light text-amber-800"><Lock className="h-7 w-7" /></div>
          <h1 className="text-2xl font-extrabold text-navy">{locked.lesson.title}</h1>
          <p className="mt-3 text-sm text-muted">{locked.lesson.description ?? 'هذا الدرس مغلق. اختر باقة مناسبة لفتحه.'}</p>
          <div className="mt-7 text-right">
            <h2 className="mb-3 text-sm font-extrabold text-navy">باقات يمكنها فتح هذا المحتوى</h2>
            <div className="space-y-3">
              {locked.suggestions.length === 0 && <p className="text-sm text-muted">لا توجد باقات متاحة حالياً، تواصل مع الإدارة.</p>}
              {locked.suggestions.map((product) => (
                <Link key={product.id} to="/app/purchases" className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition hover:border-teal">
                  <div><p className="text-sm font-bold text-navy">{product.name}</p><p className="text-xs text-muted">{product.type}</p></div>
                  <Badge tone="teal">{formatMoney(product.priceCents)}</Badge>
                </Link>
              ))}
            </div>
          </div>
          <Link to="/app/purchases" className="mt-7 inline-block"><Button>اذهب إلى الباقات</Button></Link>
        </Card>
      </div>
    );
  }

  if (!data) return <div className="text-sm text-rose-600">تعذّر تحميل الدرس.</div>;
  const { lesson } = data;
  const pdfHref = lesson.pdfFile ? privateFileUrl(lesson.pdfFile.id) : lesson.pdfUrl;
  const pdfTitle = lesson.pdfTitle ?? lesson.pdfFile?.originalName ?? 'ملف PDF';

  function embedUrl(url: string) {
    if (url.includes('youtube.com/watch?v=')) return url.replace('watch?v=', 'embed/');
    if (url.includes('youtu.be/')) return url.replace('youtu.be/', 'www.youtube.com/embed/');
    return url;
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/app/course/${lesson.unit.course.id}`} className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-teal-dark"><ArrowRight className="h-3.5 w-3.5" /> العودة للكورس</Link>
          <p className="text-xs font-bold text-teal-dark">{lesson.unit.course.subject.name} / {lesson.unit.course.title} / {lesson.unit.title}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-navy">{lesson.title}</h1>
        </div>
        {data.completed ? <Badge tone="teal"><CheckCircle2 className="ml-1 h-3.5 w-3.5" /> مكتمل</Badge> : <Badge tone="gold">لم يُكمل بعد</Badge>}
      </div>

      <Card className="overflow-hidden">
        <div className={`lesson-player bg-black ${theater ? 'fixed inset-0 z-[90] flex h-screen w-screen items-center justify-center' : 'relative w-full'}`}>
          {lesson.mediaFile ? (
            lesson.mediaFile.mimeType.startsWith('audio') ? (
              <div className={`flex flex-col items-center justify-center gap-4 bg-navy p-8 text-white ${theater ? 'h-full w-full' : 'min-h-[220px]'}`}>
                <Volume2 className="h-10 w-10 text-gold" />
                <audio controls preload="metadata" src={privateFileUrl(lesson.mediaFile.id)} className="w-full max-w-4xl" />
                <p className="text-xs text-slate-300">{lesson.mediaTitle ?? lesson.mediaFile.originalName}</p>
              </div>
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                src={privateFileUrl(lesson.mediaFile.id)}
                className={`block w-full bg-black object-contain ${theater ? 'h-full max-h-screen' : 'max-h-[calc(100vh-9rem)]'}`}
              />
            )
          ) : lesson.videoUrl ? (
            <iframe title={lesson.title} src={embedUrl(lesson.videoUrl)} className={`block w-full ${theater ? 'h-full' : 'aspect-video'}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowFullScreen />
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-slate-300"><Video className="h-10 w-10" /><p className="text-sm">لا يوجد فيديو لهذا الدرس بعد</p></div>
          )}
          {(lesson.mediaFile || lesson.videoUrl) && (
            <button
              type="button"
              onClick={() => setTheater((value) => !value)}
              title={theater ? 'تصغير المشغّل' : 'تكبير المشغّل'}
              aria-label={theater ? 'تصغير المشغّل' : 'تكبير المشغّل'}
              className="absolute left-3 top-3 z-10 rounded-lg bg-navy/70 p-2 text-white transition hover:bg-navy focus:outline-none focus:ring-2 focus:ring-gold"
            >
              {theater ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </Card>

      <div className="animate-fade-up grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="font-extrabold text-navy">وصف الدرس</h2>
            <p className="mt-2 text-sm leading-loose text-slate-600">{lesson.description ?? 'لا يوجد وصف لهذا الدرس.'}</p>
          </Card>

          {lesson.exams.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-extrabold text-navy"><ClipboardList className="h-4 w-4 text-teal" /> اختبارات مرتبطة بهذا الدرس</h2>
              <div className="flex flex-wrap gap-2">
                {lesson.exams.map((exam) => (
                  <Link key={exam.id} to={`/app/exam/${exam.id}`} className="rounded-xl bg-teal-light px-4 py-2 text-xs font-extrabold text-teal-dark hover:bg-teal/15">{exam.title}</Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="font-extrabold text-navy">مصادر الدرس</h2>
            {lesson.mediaFile && (
              <MediaLink file={lesson.mediaFile} title={lesson.mediaTitle ?? lesson.mediaFile.originalName} />
            )}
            {pdfHref ? (
              <PdfLink
                href={pdfHref}
                title={pdfTitle}
                sizeBytes={lesson.pdfFile?.sizeBytes}
                external={!lesson.pdfFile}
              />
            ) : !lesson.mediaFile ? <p className="mt-3 text-sm text-muted">لا توجد مصادر إضافية.</p> : null}
            {pdfHref && (
              <a href={pdfHref} download className="mt-3 flex items-center justify-center gap-2 text-xs font-extrabold text-teal-dark hover:underline"><Download className="h-3.5 w-3.5" /> تنزيل الملف</a>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-extrabold text-navy">تقدّمك</h2>
            <p className="mt-2 text-sm text-muted">{data.completed ? 'أنهيت هذا الدرس. أحسنت!' : 'بعد مشاهدة الدرس، سجّل إكماله لتحديث تقدّمك.'}</p>
            {message && <div className="mt-3"><Alert kind="success">{message}</Alert></div>}
            {complete.isError && <div className="mt-3"><Alert kind="error">تعذّر تسجيل الإكمال.</Alert></div>}
            <div className="mt-4 space-y-2">
              {!data.completed ? (
                <Button className="w-full" loading={complete.isPending} onClick={() => complete.mutate()}>
                  <CheckCircle2 className="h-4 w-4" /> تسجيل إكمال الدرس
                </Button>
              ) : (
                <Button variant="outline" className="w-full" loading={undo.isPending} onClick={() => undo.mutate()}>إلغاء علامة الإكمال</Button>
              )}
            </div>
          </Card>

          <Card className="bg-navy p-5 text-white">
            <PlayCircle className="mb-2 h-6 w-6 text-gold" />
            <p className="text-sm font-extrabold">نصيحة</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">لا تحتاج لاجتياز اختبار لفتح الدرس التالي. تعلّم بالوتيرة التي تناسبك.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
