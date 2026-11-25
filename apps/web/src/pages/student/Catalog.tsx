import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Layers, Search } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, TextInput } from '../../components/ui';
import { errorMessage } from '../../context/AuthContext';

interface Subject {
  id: string; name: string; slug: string; description: string | null; icon: string | null;
  courses: Array<{ id: string; title: string; description: string | null; level: string | null; slug: string }>;
}

export default function Catalog() {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: () => api.get<{ subjects: Subject[] }>('/api/catalog/subjects'),
  });

  const subjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term || !data) return data?.subjects ?? [];
    return data.subjects
      .map((subject) => ({
        ...subject,
        courses: subject.courses.filter((course) => course.title.toLowerCase().includes(term) || subject.name.toLowerCase().includes(term)),
      }))
      .filter((subject) => subject.courses.length > 0 || subject.name.toLowerCase().includes(term));
  }, [data, search]);

  if (isLoading) return <Spinner />;
  if (error) return <div className="p-4"><Alert kind="error">{errorMessage(error)}</Alert></div>;

  return (
    <div className="animate-fade-up">
      <PageHeader title="المواد والكورسات" subtitle="ابدأ من المادة التي تهمك، ثم اختر الكورس والوحدة المناسبة" />
      <div className="relative mb-7 max-w-md">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن مادة أو كورس..." className="pr-10" />
      </div>

      {subjects.length === 0 ? (
        <EmptyState title="لا توجد نتائج" description="جرّب كلمة بحث أخرى." />
      ) : (
        <div className="space-y-10">
          {subjects.map((subject) => (
            <section key={subject.id}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-sm font-extrabold text-gold">{subject.icon || <BookOpen className="h-5 w-5" />}</div>
                <div>
                  <h2 className="text-xl font-extrabold text-navy">{subject.name}</h2>
                  {subject.description && <p className="text-xs text-muted">{subject.description}</p>}
                </div>
                <Badge tone="slate" className="mr-auto">{subject.courses.length} كورسات</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {subject.courses.map((course) => (
                  <Link key={course.id} to={`/app/course/${course.id}`} className="group">
                    <Card className="h-full p-5 transition group-hover:-translate-y-1 group-hover:shadow-lift">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-light text-teal-dark"><Layers className="h-5 w-5" /></div>
                        {course.level && <Badge tone="navy">{course.level}</Badge>}
                      </div>
                      <h3 className="mt-4 font-extrabold text-navy">{course.title}</h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{course.description ?? 'محتوى تعليمي منظّم خطوة بخطوة.'}</p>
                      <div className="mt-5 flex items-center gap-1.5 text-xs font-extrabold text-teal-dark">
                        عرض الكورس <ArrowLeft className="h-3.5 w-3.5 transition group-hover:-translate-x-1" />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
