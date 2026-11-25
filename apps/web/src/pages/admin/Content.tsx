import { useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, Layers, Pencil, Plus, Trash2, Upload, Video, X } from 'lucide-react';
import { usePublicConfig } from '../../hooks/usePublicConfig';
import { ApiError, api, queryKeys } from '../../lib/api';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput } from '../../components/ui';

type Kind = 'subjects' | 'courses' | 'units' | 'lessons';
type PdfMode = 'none' | 'url' | 'upload';
type MediaMode = 'none' | 'url' | 'upload';

interface FileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ContentTree {
  subjects: Array<{
    id: string; name: string; slug: string; description: string | null; icon: string | null; sortOrder: number;
    pdfFile: FileMeta | null;
    courses: Array<{
      id: string; title: string; slug: string; description: string | null; level: string | null; sortOrder: number;
      pdfUrl: string | null; pdfTitle: string | null; pdfFile: FileMeta | null;
      units: Array<{
        id: string; title: string; description: string | null; sortOrder: number;
        pdfUrl: string | null; pdfTitle: string | null; pdfFile: FileMeta | null;
        lessons: Array<{
          id: string; title: string; description: string | null; videoUrl: string | null;
          mediaFileId: string | null; mediaTitle: string | null; mediaFile: FileMeta | null;
          pdfUrl: string | null; pdfTitle: string | null; pdfFile: FileMeta | null;
          durationMinutes: number | null; sortOrder: number; isPublished: boolean;
        }>;
      }>;
    }>;
  }>;
}

type FormValue = string | number | boolean | null;
type FormState = Record<string, FormValue>;
type FormPatch = Record<string, FormValue>;

const emptyForm: Record<Kind, FormState> = {
  subjects: { name: '', slug: '', description: '', icon: '', sortOrder: 0 },
  courses: { subjectId: '', title: '', slug: '', description: '', level: '', sortOrder: 0, pdfMode: 'none', pdfUrl: '', pdfTitle: '', pdfFileId: null, pdfFileName: '', pdfFileSize: 0 },
  units: { courseId: '', title: '', description: '', sortOrder: 0, pdfMode: 'none', pdfUrl: '', pdfTitle: '', pdfFileId: null, pdfFileName: '', pdfFileSize: 0 },
  lessons: { unitId: '', title: '', description: '', videoUrl: '', mediaMode: 'none', mediaFileId: null, mediaFileName: '', mediaFileSize: 0, mediaFileType: '', mediaTitle: '', sortOrder: 0, durationMinutes: 0, isPublished: true, pdfMode: 'none', pdfUrl: '', pdfTitle: '', pdfFileId: null, pdfFileName: '', pdfFileSize: 0 },
};

const apiFields: Record<Kind, string[]> = {
  subjects: ['name', 'slug', 'description', 'icon', 'sortOrder'],
  courses: ['subjectId', 'title', 'slug', 'description', 'level', 'sortOrder', 'pdfUrl', 'pdfTitle', 'pdfFileId'],
  units: ['courseId', 'title', 'description', 'sortOrder', 'pdfUrl', 'pdfTitle', 'pdfFileId'],
  lessons: ['unitId', 'title', 'description', 'videoUrl', 'mediaFileId', 'mediaTitle', 'durationMinutes', 'sortOrder', 'isPublished', 'pdfUrl', 'pdfTitle', 'pdfFileId'],
};

const labels: Record<Kind, string> = { subjects: 'مادة', courses: 'كورس', units: 'وحدة', lessons: 'درس' };

function cleanPayload(kind: Kind, form: FormState): FormState {
  const clean: FormState = {};
  for (const key of apiFields[kind]) {
    let value = form[key];
    if (key === 'sortOrder' || key === 'durationMinutes') value = Number(value) || 0;
    else if (typeof value === 'string' && value.trim() === '') value = null;
    clean[key] = value;
  }
  const mode = (form.pdfMode as PdfMode) ?? 'none';
  if (kind !== 'subjects') {
    clean.pdfUrl = mode === 'url' ? clean.pdfUrl : null;
    clean.pdfFileId = mode === 'upload' ? clean.pdfFileId : null;
    clean.pdfTitle = mode === 'none' ? null : clean.pdfTitle;
  }
  if (kind === 'lessons') {
    const mediaMode = (form.mediaMode as MediaMode) ?? 'none';
    clean.videoUrl = mediaMode === 'url' ? clean.videoUrl : null;
    clean.mediaFileId = mediaMode === 'upload' ? clean.mediaFileId : null;
    clean.mediaTitle = mediaMode === 'none' ? null : clean.mediaTitle;
  }
  return clean;
}

function validateForm(kind: Kind, form: FormState): string | null {
  const mode = (form.pdfMode as PdfMode) ?? 'none';
  const mediaMode = (form.mediaMode as MediaMode) ?? 'none';

  if (kind === 'lessons') {
    if (mediaMode === 'url' && !String(form.videoUrl ?? '').trim()) return 'أدخل رابط فيديو خارجي أو اختر «بدون فيديو».';
    if (mediaMode === 'upload' && !form.mediaFileId) return 'ارفع ملف MP4 أو MP3 أو اختر «بدون فيديو».';
    const hasMedia = mediaMode === 'url' ? !!String(form.videoUrl ?? '').trim() : mediaMode === 'upload' ? !!form.mediaFileId : false;
    const hasPdf = mode === 'url' ? !!String(form.pdfUrl ?? '').trim() : mode === 'upload' ? !!form.pdfFileId : false;
    if (!hasMedia && !hasPdf) return 'الدرس يحتاج مصدر محتوى: رابط فيديو أو ملف MP4/MP3 أو ملف PDF.';
    return null;
  }

  if (mode === 'url' && !String(form.pdfUrl ?? '').trim()) return 'أدخل رابط PDF خارجي أو اختر «بدون PDF».';
  if (mode === 'upload' && !form.pdfFileId) return 'ارفع ملف PDF أو اختر «بدون PDF».';
  return null;
}

export default function Content() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Kind>(() => {
    const saved = sessionStorage.getItem('sa_content_tab') as Kind | null;
    return saved && ['subjects', 'courses', 'units', 'lessons'].includes(saved) ? saved : 'subjects';
  });
  const [editing, setEditing] = useState<{ kind: Kind; id?: string; form: FormState } | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const tree = useQuery({ queryKey: queryKeys.adminContent, queryFn: () => api.get<ContentTree>('/api/admin/content') });
  const uploadConfig = usePublicConfig();
  const maxUploadBytes = uploadConfig.data?.maxUploadBytes ?? 20 * 1024 * 1024;
  const maxMediaBytes = uploadConfig.data?.maxMediaBytes ?? 200 * 1024 * 1024;

  const subjects = tree.data?.subjects ?? [];
  const courses = useMemo(() => subjects.flatMap((s) => s.courses.map((c) => ({ ...c, subjectName: s.name }))), [subjects]);
  const units = useMemo(() => courses.flatMap((c) => c.units.map((u) => ({ ...u, courseTitle: c.title }))), [courses]);
  const lessons = useMemo(() => units.flatMap((u) => u.lessons.map((l) => ({ ...l, unitTitle: u.title, courseTitle: u.courseTitle }))), [units]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminContent });
    queryClient.invalidateQueries();
  };

  const save = useMutation({
    mutationFn: ({ kind, id, form }: { kind: Kind; id?: string; form: FormState }) => {
      const payload = cleanPayload(kind, form);
      return id ? api.put(`/api/admin/${kind}/${id}`, payload) : api.post(`/api/admin/${kind}`, payload);
    },
    onSuccess: () => { invalidate(); setEditing(null); setError(''); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر الحفظ'),
  });

  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: Kind; id: string }) => api.delete(`/api/admin/${kind}/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'تعذّر الحذف'),
  });

  function patchForm(patch: FormPatch) {
    setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, ...patch } } : prev));
  }

  function setField(key: string, value: string | number | boolean) {
    patchForm({ [key]: value });
  }

  function open(kind: Kind, item?: Record<string, unknown>) {
    setError('');
    const form = { ...emptyForm[kind] };
    if (item) {
      for (const key of Object.keys(form)) {
        const value = item[key];
        if (key.startsWith('pdf') || key.startsWith('media')) continue;
        form[key] = value === null || value === undefined ? (typeof form[key] === 'boolean' ? true : '') : (value as string | number | boolean);
      }
      const media = item.mediaFile as FileMeta | null | undefined;
      form.mediaFileId = media?.id ?? null;
      form.mediaFileName = media?.originalName ?? '';
      form.mediaFileSize = media?.sizeBytes ?? 0;
      form.mediaFileType = media?.mimeType ?? '';
      form.mediaTitle = (item.mediaTitle as string | null) ?? '';
      form.videoUrl = (item.videoUrl as string | null) ?? '';
      form.mediaMode = media ? 'upload' : item.videoUrl ? 'url' : 'none';
      const file = item.pdfFile as FileMeta | null | undefined;
      form.pdfFileId = file?.id ?? null;
      form.pdfFileName = file?.originalName ?? '';
      form.pdfFileSize = file?.sizeBytes ?? 0;
      form.pdfUrl = (item.pdfUrl as string | null) ?? '';
      form.pdfTitle = (item.pdfTitle as string | null) ?? '';
      form.pdfMode = file ? 'upload' : item.pdfUrl ? 'url' : 'none';
    }
    if (kind === 'courses' && !item) form.subjectId = subjects[0]?.id ?? '';
    if (kind === 'units' && !item) form.courseId = courses[0]?.id ?? '';
    if (kind === 'lessons' && !item) form.unitId = units[0]?.id ?? '';
    setEditing({ kind, id: item?.id as string | undefined, form });
  }

  async function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('يُسمح بملفات PDF فقط.');
      event.target.value = '';
      return;
    }
    if (file.size > maxUploadBytes) {
      setError(`حجم الملف يتجاوز الحد المسموح (${Math.round(maxUploadBytes / 1024 / 1024)} ميجابايت).`);
      event.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadPdf<{ file: FileMeta }>('/api/admin/uploads/pdf', file);
      patchForm({
        pdfMode: 'upload',
        pdfFileId: result.file.id,
        pdfFileName: result.file.originalName,
        pdfFileSize: result.file.sizeBytes,
        pdfUrl: null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر رفع الملف');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  function clearPdf() {
    patchForm({ pdfMode: 'none', pdfFileId: null, pdfFileName: '', pdfFileSize: 0, pdfUrl: null });
  }

  async function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    const isMp3 = file.type === 'audio/mpeg' || file.type === 'audio/mp3' || file.name.toLowerCase().endsWith('.mp3');
    if (!isMp4 && !isMp3) {
      setError('يُسمح بملفات MP4 أو MP3 فقط.');
      event.target.value = '';
      return;
    }
    if (file.size > maxMediaBytes) {
      setError(`حجم الملف يتجاوز الحد المسموح (${Math.round(maxMediaBytes / 1024 / 1024)} ميجابايت).`);
      event.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadFile<{ file: FileMeta }>('/api/admin/uploads/media', file);
      patchForm({
        mediaMode: 'upload',
        mediaFileId: result.file.id,
        mediaFileName: result.file.originalName,
        mediaFileSize: result.file.sizeBytes,
        mediaFileType: result.file.mimeType,
        videoUrl: null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر رفع الملف');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  function clearMedia() {
    patchForm({ mediaMode: 'none', mediaFileId: null, mediaFileName: '', mediaFileSize: 0, mediaFileType: '', videoUrl: null });
  }

  function changeTab(next: Kind) {
    sessionStorage.setItem('sa_content_tab', next);
    setTab(next);
  }

  function submit() {
    if (!editing) return;
    const problem = validateForm(editing.kind, editing.form);
    if (problem) { setError(problem); return; }
    save.mutate(editing);
  }

  if (tree.isLoading) return <Spinner />;

  const tabItems: Array<{ key: Kind; icon: typeof BookOpen; count: number }> = [
    { key: 'subjects', icon: BookOpen, count: subjects.length },
    { key: 'courses', icon: Layers, count: courses.length },
    { key: 'units', icon: Layers, count: units.length },
    { key: 'lessons', icon: FileText, count: lessons.length },
  ];

  const hasPdf = (item: { pdfFile?: FileMeta | null; pdfUrl?: string | null }) => !!(item.pdfFile || item.pdfUrl);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="المواد والمحتوى"
        subtitle="أنشئ وعدّل المواد والكورسات والوحدات والدروس، وأضف PDF أو فيديو MP4/MP3 برفعه أو برابط خارجي"
        action={<Button onClick={() => open(tab)}><Plus className="h-4 w-4" /> إضافة {labels[tab]}</Button>}
      />

      {error && !editing && <div className="mb-5"><Alert kind="error">{error}</Alert></div>}

      <div className="mb-6 flex flex-wrap gap-2">
        {tabItems.map(({ key, icon: Icon, count }) => (
          <button key={key} onClick={() => changeTab(key)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === key ? 'bg-navy text-white' : 'bg-white text-slate-500 hover:text-navy'}`}>
            <Icon className="h-4 w-4" /> {key === 'subjects' ? 'المواد' : key === 'courses' ? 'الكورسات' : key === 'units' ? 'الوحدات' : 'الدروس'}
            <span className="rounded-md bg-white/20 px-1.5 text-[10px]">{count}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {tab === 'subjects' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">المادة</th><th className="p-4">المعرّف</th><th className="p-4">الكورسات</th><th className="p-4">الترتيب</th><th className="p-4">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((item) => (
                <tr key={item.id} className="hover:bg-canvas"><td className="p-4 font-bold text-navy">{item.icon} {item.name}</td><td className="code-ltr p-4 text-xs text-muted">{item.slug}</td><td className="p-4">{item.courses.length}</td><td className="p-4">{item.sortOrder}</td><td className="p-4"><RowActions onEdit={() => open('subjects', item)} onDelete={() => remove.mutate({ kind: 'subjects', id: item.id })} /></td></tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
        {tab === 'courses' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الكورس</th><th className="p-4">المادة</th><th className="p-4">المستوى</th><th className="p-4">PDF</th><th className="p-4">الوحدات</th><th className="p-4">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {courses.map((item) => (
                <tr key={item.id} className="hover:bg-canvas"><td className="p-4 font-bold text-navy">{item.title}</td><td className="p-4 text-muted">{item.subjectName}</td><td className="p-4">{item.level ? <Badge tone="navy">{item.level}</Badge> : '—'}</td><td className="p-4">{hasPdf(item) ? <Badge tone="teal">موجود</Badge> : <Badge tone="slate">—</Badge>}</td><td className="p-4">{item.units.length}</td><td className="p-4"><RowActions onEdit={() => open('courses', item)} onDelete={() => remove.mutate({ kind: 'courses', id: item.id })} /></td></tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
        {tab === 'units' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الوحدة</th><th className="p-4">الكورس</th><th className="p-4">PDF</th><th className="p-4">الدروس</th><th className="p-4">الترتيب</th><th className="p-4">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {units.map((item) => (
                <tr key={item.id} className="hover:bg-canvas"><td className="p-4 font-bold text-navy">{item.title}</td><td className="p-4 text-muted">{item.courseTitle}</td><td className="p-4">{hasPdf(item) ? <Badge tone="teal">موجود</Badge> : <Badge tone="slate">—</Badge>}</td><td className="p-4">{item.lessons.length}</td><td className="p-4">{item.sortOrder}</td><td className="p-4"><RowActions onEdit={() => open('units', item)} onDelete={() => remove.mutate({ kind: 'units', id: item.id })} /></td></tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
        {tab === 'lessons' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الدرس</th><th className="p-4">الوحدة / الكورس</th><th className="p-4">فيديو</th><th className="p-4">PDF</th><th className="p-4">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lessons.map((item) => (
                <tr key={item.id} className="hover:bg-canvas">
                  <td className="p-4 font-bold text-navy">{item.title}</td>
                  <td className="p-4 text-xs text-muted">{item.unitTitle} / {item.courseTitle}</td>
                  <td className="p-4">{item.mediaFile || item.videoUrl ? <Badge tone="teal">{item.mediaFile ? (item.mediaFile.mimeType.startsWith('audio') ? 'MP3' : 'MP4') : 'رابط'}</Badge> : <Badge tone="slate">—</Badge>}</td>
                  <td className="p-4">{hasPdf(item) ? <Badge tone="teal">موجود</Badge> : <Badge tone="slate">—</Badge>}</td>
                  <td className="p-4"><RowActions onEdit={() => open('lessons', item)} onDelete={() => remove.mutate({ kind: 'lessons', id: item.id })} /></td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? 'تعديل' : 'إضافة'} ${labels[editing?.kind ?? 'subjects']}`} wide>
        {editing && (
          <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
            {error && <Alert kind="error">{error}</Alert>}
            {editing.kind === 'courses' && <Field label="المادة"><Select value={String(editing.form.subjectId ?? '')} onChange={(e) => setField('subjectId', e.target.value)} required>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
            {editing.kind === 'units' && <Field label="الكورس"><Select value={String(editing.form.courseId ?? '')} onChange={(e) => setField('courseId', e.target.value)} required>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>}
            {editing.kind === 'lessons' && <Field label="الوحدة"><Select value={String(editing.form.unitId ?? '')} onChange={(e) => setField('unitId', e.target.value)} required>{units.map((u) => <option key={u.id} value={u.id}>{u.courseTitle} — {u.title}</option>)}</Select></Field>}

            <Field label="الاسم / العنوان"><TextInput required value={String(editing.form.name ?? editing.form.title ?? '')} onChange={(e) => setField(editing.kind === 'subjects' ? 'name' : 'title', e.target.value)} /></Field>
            {(editing.kind === 'subjects' || editing.kind === 'courses') && <Field label="المعرّف (slug)" hint="يُولَّد تلقائياً إذا تُرك فارغاً"><TextInput dir="ltr" className="code-ltr text-left" value={String(editing.form.slug ?? '')} onChange={(e) => setField('slug', e.target.value)} /></Field>}
            {editing.kind === 'courses' && <Field label="المستوى"><TextInput value={String(editing.form.level ?? '')} onChange={(e) => setField('level', e.target.value)} placeholder="مبتدئ / متوسط / ثانوية عامة" /></Field>}
            {editing.kind === 'subjects' && <Field label="الأيقونة"><TextInput value={String(editing.form.icon ?? '')} onChange={(e) => setField('icon', e.target.value)} placeholder="</> أو #" /></Field>}

            <Field label="الوصف"><TextArea rows={3} value={String(editing.form.description ?? '')} onChange={(e) => setField('description', e.target.value)} /></Field>

            {editing.kind === 'lessons' && (
              <div className="rounded-xl border border-slate-200 bg-canvas p-4">
                <p className="mb-3 text-sm font-extrabold text-navy">مصدر الفيديو / المحاضرة</p>
                <div className="mb-4 flex flex-wrap gap-4 text-xs font-bold text-slate-600">
                  <label className="flex items-center gap-1.5"><input type="radio" name="mediaMode" checked={(editing.form.mediaMode as MediaMode) === 'none'} onChange={() => patchForm({ mediaMode: 'none', videoUrl: null, mediaFileId: null, mediaFileName: '', mediaFileSize: 0, mediaFileType: '' })} /> بدون فيديو</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="mediaMode" checked={(editing.form.mediaMode as MediaMode) === 'url'} onChange={() => patchForm({ mediaMode: 'url', mediaFileId: null, mediaFileName: '', mediaFileSize: 0, mediaFileType: '' })} /> رابط خارجي</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="mediaMode" checked={(editing.form.mediaMode as MediaMode) === 'upload'} onChange={() => patchForm({ mediaMode: 'upload', videoUrl: null })} /> رفع ملف MP4/MP3</label>
                </div>

                {editing.form.mediaMode === 'url' && (
                  <Field label="رابط الفيديو الخارجي" hint="رابط YouTube أو أي رابط فيديو مباشر">
                    <TextInput dir="ltr" className="code-ltr text-left" value={String(editing.form.videoUrl ?? '')} onChange={(e) => setField('videoUrl', e.target.value)} placeholder="https://youtube.com/watch?v=..." />
                  </Field>
                )}

                {editing.form.mediaMode === 'upload' && (
                  <Field label="رفع فيديو أو صوت" hint={`MP4 أو MP3 فقط · الحد الأقصى ${Math.round(maxMediaBytes / 1024 / 1024)} ميجابايت`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <input type="file" accept="video/mp4,audio/mpeg,audio/mp3,.mp4,.mp3" onChange={selectMedia} disabled={uploading} className="max-w-full text-xs" />
                      {uploading && <span className="text-xs font-bold text-teal-dark">جارٍ الرفع...</span>}
                    </div>
                    {editing.form.mediaFileId && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal/20 bg-teal-light/50 p-3 text-xs">
                        <span className="flex items-center gap-2 font-bold text-teal-dark"><Video className="h-4 w-4" /> {String(editing.form.mediaFileName)} · {(Number(editing.form.mediaFileSize) / 1024 / 1024).toFixed(2)} MB</span>
                        <button type="button" onClick={clearMedia} className="rounded-lg p-1 text-rose-600 hover:bg-rose-50" title="إزالة الملف"><X className="h-4 w-4" /></button>
                      </div>
                    )}
                  </Field>
                )}

                {editing.form.mediaMode !== 'none' && (
                  <div className="mt-3">
                    <Field label="عنوان الفيديو (اختياري)"><TextInput value={String(editing.form.mediaTitle ?? '')} onChange={(e) => setField('mediaTitle', e.target.value)} placeholder="محاضرة الدرس الأولى" /></Field>
                  </div>
                )}
              </div>
            )}

            {editing.kind !== 'subjects' && (
              <div className="rounded-xl border border-slate-200 bg-canvas p-4">
                <p className="mb-3 text-sm font-extrabold text-navy">مصدر ملف PDF</p>
                <div className="mb-4 flex flex-wrap gap-4 text-xs font-bold text-slate-600">
                  <label className="flex items-center gap-1.5"><input type="radio" name="pdfMode" checked={(editing.form.pdfMode as PdfMode) === 'none'} onChange={() => patchForm({ pdfMode: 'none', pdfUrl: null })} /> بدون PDF</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="pdfMode" checked={(editing.form.pdfMode as PdfMode) === 'url'} onChange={() => patchForm({ pdfMode: 'url', pdfFileId: null, pdfFileName: '', pdfFileSize: 0 })} /> رابط خارجي</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="pdfMode" checked={(editing.form.pdfMode as PdfMode) === 'upload'} onChange={() => patchForm({ pdfMode: 'upload', pdfUrl: null })} /> رفع ملف</label>
                </div>

                {editing.form.pdfMode === 'url' && (
                  <Field label="رابط PDF خارجي">
                    <TextInput dir="ltr" className="code-ltr text-left" value={String(editing.form.pdfUrl ?? '')} onChange={(e) => setField('pdfUrl', e.target.value)} placeholder="https://example.com/notes.pdf" />
                  </Field>
                )}

                {editing.form.pdfMode === 'upload' && (
                  <Field label="Upload PDF" hint={`PDF فقط · الحد الأقصى ${Math.round(maxUploadBytes / 1024 / 1024)} ميجابايت`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <input type="file" accept="application/pdf,.pdf" onChange={selectPdf} disabled={uploading} className="max-w-full text-xs" />
                      {uploading && <span className="text-xs font-bold text-teal-dark">جارٍ الرفع...</span>}
                    </div>
                    {editing.form.pdfFileId && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal/20 bg-teal-light/50 p-3 text-xs">
                        <span className="flex items-center gap-2 font-bold text-teal-dark"><FileText className="h-4 w-4" /> {String(editing.form.pdfFileName)} · {(Number(editing.form.pdfFileSize) / 1024 / 1024).toFixed(2)} MB</span>
                        <button type="button" onClick={clearPdf} className="rounded-lg p-1 text-rose-600 hover:bg-rose-50" title="إزالة الملف"><X className="h-4 w-4" /></button>
                      </div>
                    )}
                  </Field>
                )}

                {editing.form.pdfMode !== 'none' && (
                  <div className="mt-3">
                    <Field label="عنوان الملف (اختياري)"><TextInput value={String(editing.form.pdfTitle ?? '')} onChange={(e) => setField('pdfTitle', e.target.value)} placeholder="ملف الدرس" /></Field>
                  </div>
                )}
              </div>
            )}

            {editing.kind === 'lessons' ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="المدة (دقائق)"><TextInput type="number" min={0} value={Number(editing.form.durationMinutes ?? 0)} onChange={(e) => setField('durationMinutes', Number(e.target.value))} /></Field>
                <Field label="الترتيب"><TextInput type="number" min={0} value={Number(editing.form.sortOrder ?? 0)} onChange={(e) => setField('sortOrder', Number(e.target.value))} /></Field>
                <label className="flex items-end gap-2 pb-2 text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-teal" checked={!!editing.form.isPublished} onChange={(e) => setField('isPublished', e.target.checked)} /> منشور</label>
              </div>
            ) : (
              <Field label="الترتيب"><TextInput type="number" min={0} value={Number(editing.form.sortOrder ?? 0)} onChange={(e) => setField('sortOrder', Number(e.target.value))} /></Field>
            )}

            <div className="flex justify-end gap-2 pt-3">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
              <Button type="submit" loading={save.isPending || uploading}><Upload className="h-4 w-4" /> حفظ</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-1">
      <button onClick={onEdit} className="rounded-lg p-2 text-teal-dark hover:bg-teal-light" title="تعديل"><Pencil className="h-4 w-4" /></button>
      <button onClick={() => { if (confirm('هل تريد الحذف؟')) onDelete(); }} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" title="حذف"><Trash2 className="h-4 w-4" /></button>
    </div>
  );
}
