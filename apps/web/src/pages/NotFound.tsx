import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <p className="text-7xl font-extrabold text-navy/10">404</p>
      <h1 className="mt-2 text-2xl font-extrabold text-navy">الصفحة غير موجودة</h1>
      <p className="mt-2 text-sm text-muted">ربما تم نقل الصفحة أو أن الرابط غير صحيح.</p>
      <Link to="/" className="mt-6"><Button>العودة للرئيسية</Button></Link>
    </div>
  );
}
