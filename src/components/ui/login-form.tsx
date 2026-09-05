import { type FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

type WorkspaceUser = { id: string; email: string; displayName: string };
type LoginFormProps = { onAuthenticated: (user: WorkspaceUser) => void };

export default function LoginForm({ onAuthenticated }: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/status').then(async (response) => {
      const data = await response.json() as { setupRequired?: boolean; user?: WorkspaceUser | null };
      if (!response.ok) throw new Error('无法读取工作区状态。');
      if (data.user) onAuthenticated(data.user);
      setSetupRequired(Boolean(data.setupRequired));
    }).catch((error) => setNotice(error instanceof Error ? error.message : '无法连接本地服务。')).finally(() => setIsReady(true));
  }, [onAuthenticated]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)) {
      setNotice('请输入有效的邮箱地址。');
      return;
    }
    if (!password) {
      setNotice('请输入密码。');
      return;
    }
    if (setupRequired && (!displayName.trim() || displayName.trim().length > 80)) {
      setNotice('请输入 1 至 80 个字符的姓名。');
      return;
    }
    setIsSubmitting(true);
    try {
      const endpoint = setupRequired ? '/api/auth/setup' : isResettingPassword ? '/api/auth/reset-password' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: normalizedEmail, displayName: displayName.trim(), password, rememberMe }),
      });
      const data = await response.json() as { user?: WorkspaceUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || '无法完成登录。');
      onAuthenticated(data.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法完成登录。');
    } finally { setIsSubmitting(false); }
  };

  return (
    <main className="min-h-screen bg-white text-[#171720]">
      <section className="grid min-h-screen w-full overflow-hidden bg-white lg:grid-cols-[minmax(0,1.08fr)_minmax(480px,0.92fr)]">
        <aside className="relative hidden min-h-[720px] overflow-hidden lg:block" aria-label="创作工作台场景">
          <img className="absolute inset-0 h-full w-full object-cover" src="/login/creator-workbench-login.png" alt="内容创作者的工作台，桌上有相机、笔记本和用于规划内容的电脑" />
          <div className="login-photo-overlay absolute inset-0" aria-hidden="true" />
          <div className="absolute inset-x-0 top-0 p-10">
            <div className="flex items-center gap-3 text-white">
              <img className="h-12 w-12 object-contain" src="/brand/cat-mark-v2.svg" alt="Cato AI" />
              <span className="text-[24px] font-bold tracking-[-0.055em]">Cato AI</span>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-16 p-10 text-white">
            <p className="whitespace-nowrap text-[32px] font-semibold leading-[1.16] tracking-[-0.05em]">自媒体内容工作台</p>
            <p className="mt-3 text-sm leading-6 text-white/70">选题、稿件和发布计划。</p>
          </div>
        </aside>

        <div className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10 lg:px-[clamp(3rem,7vw,7.5rem)]">
          <form className="w-full max-w-[384px]" onSubmit={handleSubmit} noValidate>
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-2.5">
                <img className="h-11 w-11 object-contain" src="/brand/cat-mark-v2.svg" alt="Cato AI" />
                <span className="text-xl font-bold tracking-[-0.055em]">Cato AI</span>
              </div>
            </div>

            <header>
              <p className="text-sm font-medium text-[#676775]">自媒体 AI 工作台</p>
              <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.055em] text-[#171720] sm:text-[38px]">{setupRequired ? '创建工作区' : isResettingPassword ? '重设密码' : '欢迎回来'}</h1>
              <p className="mt-3 text-sm leading-6 text-[#737381]">{setupRequired ? '首次使用，请创建唯一的工作区账号。' : isResettingPassword ? '仅限这台设备上的本地工作区。保存后将直接登录。' : '登录后继续管理你的内容创作流程。'}</p>
            </header>

            <div className="mt-9 space-y-5">
              {setupRequired && !isResettingPassword && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#343440]">姓名</span>
                  <span className="flex h-12 items-center gap-3 rounded-xl border border-[#dedee5] bg-white px-4 transition-colors focus-within:border-[#30303b]">
                    <UserRound size={17} strokeWidth={1.8} className="shrink-0 text-[#858593]" aria-hidden="true" />
                    <input className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-[#20202b] outline-none placeholder:text-[#a2a2ad]" type="text" name="name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：Evan" maxLength={80} required />
                  </span>
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#343440]">邮箱</span>
                <span className="flex h-12 items-center gap-3 rounded-xl border border-[#dedee5] bg-white px-4 transition-colors focus-within:border-[#30303b]">
                  <Mail size={17} strokeWidth={1.8} className="shrink-0 text-[#858593]" aria-hidden="true" />
                  <input className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-[#20202b] outline-none placeholder:text-[#a2a2ad]" type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" maxLength={254} aria-invalid={Boolean(notice && !/密码/.test(notice))} required />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#343440]">密码</span>
                <span className="flex h-12 items-center gap-3 rounded-xl border border-[#dedee5] bg-white px-4 transition-colors focus-within:border-[#30303b]">
                  <LockKeyhole size={17} strokeWidth={1.8} className="shrink-0 text-[#858593]" aria-hidden="true" />
                  <input className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-[#20202b] outline-none placeholder:text-[#a2a2ad]" type={showPassword ? 'text' : 'password'} name="password" autoComplete={setupRequired || isResettingPassword ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setupRequired || isResettingPassword ? '创建新密码' : '输入你的密码'} maxLength={256} aria-invalid={Boolean(notice && /密码/.test(notice))} required />
                  <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#858593] transition-colors hover:bg-[#f4f4f7] hover:text-[#4a4a57] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635bdb]" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                    {showPassword ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}
                  </button>
                </span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2.5 text-[#676775]">
                <input className="peer sr-only" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] border border-[#c8c8d1] bg-white text-[11px] text-white transition peer-checked:border-[#635bdb] peer-checked:bg-[#635bdb] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#635bdb]">✓</span>
                记住我
              </label>
              {setupRequired ? <span /> : <button className="font-medium text-[#5147d9] transition-colors hover:text-[#382fc0] hover:underline" type="button" onClick={() => { setIsResettingPassword((current) => !current); setPassword(''); setNotice(''); }}>{isResettingPassword ? '返回登录' : '忘记密码？'}</button>}
            </div>

            <button className={cn('mt-8 flex h-12 w-full items-center justify-center rounded-xl bg-[#5147d9] text-sm font-semibold text-white transition hover:bg-[#453cc8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5147d9] disabled:cursor-wait disabled:opacity-70', isSubmitting && 'scale-[0.99]')} type="submit" disabled={isSubmitting || !isReady}>
              {isSubmitting ? '正在保存…' : !isReady ? '正在连接…' : setupRequired ? '创建并进入工作台' : isResettingPassword ? '保存新密码并登录' : '登录'}
            </button>

            <p className={`mt-4 min-h-5 text-center text-xs leading-5 ${notice ? 'rounded-lg border border-[#f0cccc] bg-[#fff7f7] px-3 py-2 text-[#b42318]' : 'text-[#857b68]'}`} role={notice ? 'alert' : undefined} aria-live="polite">{notice}</p>
          </form>
        </div>
      </section>
    </main>
  );
}
