import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Download, FileText, Lock, PlayCircle, Video } from 'lucide-react';
import { api, privateFileUrl, queryKeys } from '../../lib/api';
import { Badge, Button, Card, ProgressBar, Spinner } from '../../components/ui';

interface PdfFileMeta {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
}

interface CourseData {
  course: {
    id: string; title: string; description: string | null; level: string | null;
    subject: { name: string };
    pdfFile: PdfFileMeta | null;
    units: Array<{
      id: string; title: string; description: string | null; unlocked: boolean;
      pdfFile: PdfFileMeta | null;
      lessons: Array<{ id: string; title: string; durationMinutes: number | null; unlocked: boolean; pdfUrl: string | null; pdfFile: PdfFileMeta | null; mediaFile: PdfFileMeta | null }>;
      exams: Array<{ id: string; title: string; passingScore: number }>;
    }>;
  };
  completedLessonIds: string[];
  unlocked: boolean;
}

function PdfDownload({ href, title, compact = false }: { href: string; title: string; compact?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={compact ? 'inline-flex items-center gap-1 text-xs font-bold text-teal-dark hover:underline' : 'inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100'}>
      <Download className="h-3.5 w-3.5" /> <span className="max-w-[160px] truncate">{title}</span>
    </a>
  );
}

export default function CoursePage() {
  const { id } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.course(id!),
    queryFn: () => api.get<CourseData>(`/api/catalog/courses/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <Spinner />;
  if (isError || !data) return <div className="text-sm text-rose-600">تعذّر تحميل الكورس.</div>;

  const { course, completedLessonIds } = data;
  const allLessons = course.units.flatMap((u) => u.lessons);
  const completed = allLessons.filter((l) => completedLessonIds.includes(l.id)).length;
  const percent = allLessons.length ? Math.round((completed / allLessons.length) * 100) : 0;

  return (
    <div className="animate-fade-up">
      <Link to="/app/catalog" className="mb-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-teal-dark"><ArrowRight className="h-3.5 w-3.5" /> العودة للمواد</Link>

      <Card className="overflow-hidden">
        <div className="bg-navy p-6 text-white md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-teal-200">{course.subject.name}</p>
              <h1 className="mt-2 text-2xl font-extrabold md:text-3xl">{course.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{course.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {course.level && <Badge tone="gold">{course.level}</Badge>}
                <Badge tone="navy">{course.units.length} وحدات</Badge>
                <Badge tone="navy">{allLessons.length} دروس</Badge>
                {course.pdfFile && data.unlocked && <PdfDownload href={privateFileUrl(course.pdfFile.id)} title={course.pdfFile.originalName} />}
              </div>
            </div>
            <div className="w-full max-w-xs rounded-2xl bg-white/10 p-4 backdrop-blur">
              <div className="flex items-center justify-between text-xs font-bold"><span>تقدّمك في الكورس</span><span>{percent}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-gold" style={{ width: `${percent}%` }} /></div>
              <p className="mt-2 text-[11px] text-slate-300">{completed} من {allLessons.length} دروس مكتملة</p>
            </div>
          </div>
        </div>
      </Card>

      {!data.unlocked && (
        <div className="mt-6 rounded-2xl border border-gold/30 bg-gold-light p-5 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-bold">هذا الكورس مغلق. يمكنك شراء اشتراك أو وحدة منفردة لفتح الدروس.</p>
            <Link to="/app/purchases"><Button variant="gold" size="sm">عرض الباقات</Button></Link>
          </div>
        </div>
      )}

      <div className="mt-8 space-y-5">
        {course.units.map((unit, index) => (
          <Card key={unit.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-xs font-extrabold text-white">{index + 1}</div>
                <div><h2 className="font-extrabold text-navy">{unit.title}</h2>{unit.description && <p className="text-xs text-muted">{unit.description}</p>}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {unit.pdfFile && unit.unlocked && <PdfDownload href={privateFileUrl(unit.pdfFile.id)} title={unit.pdfFile.originalName} compact />}
                {!unit.unlocked && <Badge tone="gold"><Lock className="ml-1 inline h-3 w-3" /> مغلق</Badge>}
                <Badge tone="slate">{unit.lessons.length} دروس</Badge>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {unit.lessons.map((lesson) => {
                const done = completedLessonIds.includes(lesson.id);
                return (
                  <div key={lesson.id} className="flex flex-wrap items-center gap-3 px-5 py-4 transition hover:bg-canvas">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${done ? 'bg-teal-light text-teal-dark' : 'bg-slate-100 text-muted'}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" /> : lesson.unlocked ? <PlayCircle className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-navy">{lesson.title}</p>
                      <p className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                        {lesson.durationMinutes ? <span className="flex items-center gap-1"><Video className="h-3 w-3" /> {lesson.durationMinutes} دقيقة</span> : null}
                        {lesson.mediaFile && <span className="flex items-center gap-1"><Video className="h-3 w-3" /> {lesson.mediaFile.mimeType.startsWith('audio') ? 'MP3' : 'MP4'}</span>}
                        {(lesson.pdfFile || lesson.pdfUrl) && <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> ملف PDF</span>}
                        {done && <span className="font-bold text-teal-dark">مكتمل</span>}
                      </p>
                    </div>
                    {lesson.unlocked ? (
                      <Link to={`/app/lesson/${lesson.id}`}><Button size="sm" variant={done ? 'outline' : 'teal'}>{done ? 'مراجعة' : 'ابدأ الدرس'} <ArrowLeft className="h-3.5 w-3.5" /></Button></Link>
                    ) : (
                      <Link to="/app/purchases"><Button size="sm" variant="ghost"><Lock className="h-3.5 w-3.5" /> فتح الدرس</Button></Link>
                    )}
                  </div>
                );
              })}
            </div>
            {unit.exams.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs">
                <span className="flex items-center gap-1.5 font-bold text-muted"><ClipboardList className="h-3.5 w-3.5" /> اختبارات هذه الوحدة</span>
                <div className="flex flex-wrap gap-2">
                  {unit.exams.map((exam) => (
                    <Link key={exam.id} to={`/app/exam/${exam.id}`} className="rounded-lg bg-teal-light px-3 py-1.5 font-bold text-teal-dark hover:bg-teal/15">
                      {exam.title} · نجاح {exam.passingScore}%
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
