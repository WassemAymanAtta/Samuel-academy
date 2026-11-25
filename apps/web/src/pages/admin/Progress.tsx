import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { Badge, Card, PageHeader, ProgressBar, Select, Spinner, TextInput, formatDate } from '../../components/ui';

interface Row {
  studentId: string; studentName: string; studentEmail: string; courseId: string; courseTitle: string; subject: string;
  completed: number; total: number; percent: number; lastActivity: string | null; averageExamPercent: number | null;
}
interface ProgressData { rows: Row[]; courses: Array<{ id: string; title: string }> }

export default function Progress() {
  const [studentSearch, setStudentSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const { data, isLoading } = useQuery({ queryKey: queryKeys.adminProgress, queryFn: () => api.get<ProgressData>('/api/admin/progress') });

  const rows = useMemo(() => (data?.rows ?? []).filter((row) =>
    (!courseFilter || row.courseId === courseFilter) &&
    (row.studentName.toLowerCase().includes(studentSearch.toLowerCase()) || row.studentEmail.toLowerCase().includes(studentSearch.toLowerCase())),
  ), [data, courseFilter, studentSearch]);

  if (isLoading) return <Spinner />;

  return (
    <div className="animate-fade-up">
      <PageHeader title="تقدم الطلاب" subtitle="تابع نسبة إكمال الدروس ومتوسط درجات الاختبارات لكل طالب" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><TextInput placeholder="ابحث عن طالب..." value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="pr-10" /></div>
        <Select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="">كل الكورسات</option>{(data?.courses ?? []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-muted"><tr><th className="p-4">الطالب</th><th className="p-4">الكورس</th><th className="p-4">المادة</th><th className="p-4">التقدّم</th><th className="p-4">متوسط الاختبارات</th><th className="p-4">آخر نشاط</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-muted">لا توجد نتائج مطابقة.</td></tr>}
              {rows.map((row) => (
                <tr key={`${row.studentId}-${row.courseId}`} className="hover:bg-canvas">
                  <td className="p-4"><p className="font-bold text-navy">{row.studentName}</p><p className="code-ltr text-[11px] text-muted">{row.studentEmail}</p></td>
                  <td className="p-4 font-bold text-navy">{row.courseTitle}</td>
                  <td className="p-4 text-muted">{row.subject}</td>
                  <td className="p-4"><div className="flex items-center gap-3"><ProgressBar value={row.percent} className="w-24" /><span className="text-xs font-extrabold text-navy">{row.percent}%</span></div><p className="mt-1 text-[11px] text-muted">{row.completed}/{row.total} درس</p></td>
                  <td className="p-4">{row.averageExamPercent === null ? <Badge tone="slate">—</Badge> : <Badge tone={row.averageExamPercent >= 60 ? 'teal' : 'rose'}>{row.averageExamPercent}%</Badge>}</td>
                  <td className="p-4 text-xs text-muted">{formatDate(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
