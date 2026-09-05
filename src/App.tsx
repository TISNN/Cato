import { useCallback, useState } from 'react';
import CatoWorkbench from '@/CatoWorkbench';
import LoginForm from '@/components/ui/login-form';

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string; displayName: string } | null>(null);
  const handleAuthenticated = useCallback((nextUser: { id: string; email: string; displayName: string }) => setUser(nextUser), []);
  const handleLogout = useCallback(() => setUser(null), []);
  return user ? <CatoWorkbench user={user} onLogout={handleLogout} /> : <LoginForm onAuthenticated={handleAuthenticated} />;
}
