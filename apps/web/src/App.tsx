import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/ui';
import SiteIntro from './components/SiteIntro';
import { AdminLayout, PublicLayout, StudentLayout } from './components/Layouts';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import StudentDashboard from './pages/student/Dashboard';
import Catalog from './pages/student/Catalog';
import CoursePage from './pages/student/CoursePage';
import LessonPage from './pages/student/LessonPage';
import ExamPage from './pages/student/ExamPage';
import Results from './pages/student/Results';
import Purchases from './pages/student/Purchases';
import AdminDashboard from './pages/admin/AdminDashboard';
import Students from './pages/admin/Students';
import PendingStudents from './pages/admin/PendingStudents';
import Content from './pages/admin/Content';
import Exams from './pages/admin/Exams';
import Products from './pages/admin/Products';
import Payments from './pages/admin/Payments';
import Progress from './pages/admin/Progress';
import NotFound from './pages/NotFound';

function Protected({ role, children }: { role?: 'STUDENT' | 'ADMIN'; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/app'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <SiteIntro />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route path="/app" element={<Protected role="STUDENT"><StudentLayout /></Protected>}>
          <Route index element={<StudentDashboard />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="course/:id" element={<CoursePage />} />
          <Route path="lesson/:id" element={<LessonPage />} />
          <Route path="exam/:id" element={<ExamPage />} />
          <Route path="results" element={<Results />} />
          <Route path="results/:attemptId" element={<Results />} />
          <Route path="purchases" element={<Purchases />} />
        </Route>

        <Route path="/admin" element={<Protected role="ADMIN"><AdminLayout /></Protected>}>
          <Route index element={<AdminDashboard />} />
          <Route path="students" element={<Students />} />
          <Route path="students/pending" element={<PendingStudents />} />
          <Route path="content" element={<Content />} />
          <Route path="exams" element={<Exams />} />
          <Route path="products" element={<Products />} />
          <Route path="payments" element={<Payments />} />
          <Route path="progress" element={<Progress />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
