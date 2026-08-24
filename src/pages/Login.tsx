import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Mail, ShieldCheck, AlertCircle, ArrowRight, Eye, EyeOff, Briefcase, Wallet, BookOpen, ShoppingCart, Users2, Calculator, CheckCircle2 } from "lucide-react";
import logoGN from "@/assets/logo-grupo-nascimento.png";
import { useDemoMode } from "@/context/DemoModeContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROTAS_EXTERNO } from "@/hooks/useModoExterno";

export default function Login() {
  const [showPwd, setShowPwd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";
  const successMsg = (location.state as { successMsg?: string } | null)?.successMsg ?? null;
  const { disableDemo } = useDemoMode();
  const { user, loading: authLoading } = useAuth();

  // ?next=/rota — p/ onde voltar depois de entrar (formulário restrito manda
  // o respondente pra cá e quer ele de volta na página do formulário).
  // Só caminho interno: barra o open-redirect p/ site externo (//evil.com).
  const nextRaw = new URLSearchParams(location.search).get("next");
  const destino = nextRaw && /^\/(?!\/)/.test(nextRaw) ? nextRaw : "/app";

  if (!authLoading && user) {
    // Sessão anônima = usuário externo. A aba que criava essas sessões saiu do
    // login (todo encarregado passou a ter conta de e-mail e senha), mas as
    // sessões abertas ANTES continuam válidas até a pessoa sair — e o destino
    // delas nunca é o painel geral, que a allowlist do externo nega.
    return <Navigate to={user.is_anonymous ? ROTAS_EXTERNO[0] : destino} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      disableDemo();
      navigate(destino);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (msg.includes("Invalid login credentials")) setError("E-mail ou senha incorretos.");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Painel institucional */}
      <aside className="relative hidden overflow-hidden bg-gradient-hero text-white lg:flex lg:flex-col lg:p-12">
        <div className="absolute inset-0 bg-gradient-mesh opacity-60" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary-glow/20 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 p-1.5 backdrop-blur ring-1 ring-white/20">
            <img src={logoGN} alt="Grupo Nascimento" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="font-display text-base font-bold leading-tight">Grupo Nascimento</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">ERP Corporativo</p>
          </div>
        </div>

        <div className="relative z-10 mt-auto max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-wider text-white/80 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> ERP Corporativo Multi-CNPJ
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight">
            Plataforma corporativa para a gestão integrada do Grupo Nascimento.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Licitações, Contratos, Financeiro, Contábil, Suprimentos, RH e Controladoria —
            em uma única plataforma multi-CNPJ, segura e auditável.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              { i: Briefcase, l: "Licitações", s: "Ativo" },
              { i: Wallet, l: "Financeiro", s: "Em breve" },
              { i: BookOpen, l: "Contábil", s: "Em breve" },
              { i: ShoppingCart, l: "Suprimentos", s: "Em breve" },
              { i: Users2, l: "RH", s: "Em breve" },
              { i: Calculator, l: "Controladoria", s: "Em breve" },
            ].map((m) => {
              const active = m.s === "Ativo";
              return (
                <div
                  key={m.l}
                  className={
                    "rounded-xl border px-3 py-3 backdrop-blur " +
                    (active ? "border-accent/40 bg-accent/10" : "border-white/10 bg-white/5")
                  }
                >
                  <m.i className={"mb-1.5 h-4 w-4 " + (active ? "text-accent" : "text-white/60")} />
                  <p className="text-[12px] font-semibold leading-tight text-white">{m.l}</p>
                  <p className={"mt-0.5 text-[10px] uppercase tracking-wider " + (active ? "text-accent" : "text-white/50")}>{m.s}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative z-10 mt-10 text-[11px] text-white/50">
          © 2025 Grupo Nascimento — Todos os direitos reservados · v3.4.0
        </p>
      </aside>

      {/* Formulário */}
      <section className="flex items-center justify-center bg-background p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <img src={logoGN} alt="Grupo Nascimento" className="h-10 w-10 object-contain" />
              <p className="font-display font-bold">Grupo Nascimento</p>
            </div>
          </div>

          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-success" /> Acesso restrito
          </div>
          <h2 className="font-display text-2xl font-bold">Acessar o ERP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use suas credenciais corporativas para acessar o ERP.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Novos acessos são criados pelo administrador do sistema.
          </p>

          {sessionExpired && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p><span className="font-semibold text-amber-700">Sessão expirada.</span> Por inatividade, sua sessão foi encerrada automaticamente. Faça login novamente para continuar.</p>
            </div>
          )}

          {successMsg && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <p>{successMsg}</p>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="E-mail corporativo" icon={<Mail className="h-4 w-4" />}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome.sobrenome@gruponascimento.com.br"
                className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </Field>

            <Field label="Senha" icon={<Lock className="h-4 w-4" />}>
              <input
                type={showPwd ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-10 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="btn-relief group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-accent text-sm font-semibold text-accent-foreground transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {loading ? "Aguarde…" : "Entrar na plataforma"}
              {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
            </button>

            <div className="text-center">
              <Link
                to="/esqueci-senha"
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Esqueci minha senha
              </Link>
            </div>
          </form>

          <div className="my-6 divider-soft" />

          <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Acesso monitorado</p>
            <p className="mt-1 leading-relaxed">
              Toda autenticação é registrada com data, hora, IP e dispositivo. Atividades suspeitas
              acionam bloqueio automático e auditoria.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
  label, icon, right, children,
}: { label: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        {right}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
        {children}
      </div>
    </div>
  );
}
