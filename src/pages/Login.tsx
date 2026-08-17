import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Mail, ShieldCheck, AlertCircle, ArrowRight, Eye, EyeOff, Briefcase, Wallet, BookOpen, ShoppingCart, Users2, Calculator, CheckCircle2 } from "lucide-react";
import logoGN from "@/assets/logo-grupo-nascimento.png";
import { useDemoMode } from "@/context/DemoModeContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useContratosExternos } from "@/hooks/useSupPedidos";
import { ROTAS_EXTERNO } from "@/hooks/useModoExterno";

type Aba = "colaborador" | "externo";

/** Máscaras da aba Externo — o encarregado digita do celular, no posto. */
function mascararCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length > 9) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, "$1.$2.$3-$4");
  if (d.length > 6) return d.replace(/(\d{3})(\d{3})(\d{0,3})/, "$1.$2.$3");
  if (d.length > 3) return d.replace(/(\d{3})(\d{0,3})/, "$1.$2");
  return d;
}
function mascararData(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length > 4) return d.replace(/(\d{2})(\d{2})(\d{0,4})/, "$1/$2/$3");
  if (d.length > 2) return d.replace(/(\d{2})(\d{0,2})/, "$1/$2");
  return d;
}

export default function Login() {
  const [aba, setAba] = useState<Aba>("colaborador");
  const [showPwd, setShowPwd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aba "Externo": identidade conferida contra o cadastro de EMPREGADOS por
  // CPF + data de nascimento. Só entra quem está ativo — quem foi desligado
  // perde o acesso sozinho, sem ninguém precisar revogar nada.
  const [extCpf, setExtCpf] = useState("");
  const [extNasc, setExtNasc] = useState("");
  const [extContrato, setExtContrato] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";
  const successMsg = (location.state as { successMsg?: string } | null)?.successMsg ?? null;
  const { disableDemo } = useDemoMode();
  const { user, loading: authLoading } = useAuth();
  const { data: contratosExternos = [], isLoading: carregandoContratos } =
    useContratosExternos(aba === "externo");

  // ?next=/rota — p/ onde voltar depois de entrar (formulário restrito manda
  // o respondente pra cá e quer ele de volta na página do formulário).
  // Só caminho interno: barra o open-redirect p/ site externo (//evil.com).
  const nextRaw = new URLSearchParams(location.search).get("next");
  const destino = nextRaw && /^\/(?!\/)/.test(nextRaw) ? nextRaw : "/app";

  if (!authLoading && user) {
    // Sessão anônima = usuário externo: o destino dele nunca é o painel geral.
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

  /**
   * Entrada do encarregado. A identidade é conferida contra o cadastro de
   * EMPREGADOS (CPF + data de nascimento), então o pedido chega assinado com
   * o nome real da pessoa, não com um texto que ela digitou.
   *
   * A ordem importa: pré-valida ANTES de abrir sessão, para um CPF errado
   * não deixar um usuário órfão no auth a cada tentativa. Mas quem decide de
   * fato é sup_ext_entrar_empregado, que revalida tudo do zero — a
   * pré-validação é só conveniência.
   *
   * Quem já tem conta vinculada (EMPREGADOS.auth_user_id, via Administração
   * > Usuários > Vincular colaborador) entra na conta REAL — sup-ext-
   * verificar-vinculo devolve um magic link trocável por sessão de verdade
   * (verifyOtp). Sem vínculo, cai no mesmo fluxo anônimo de sempre.
   */
  const handleExterno = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (extCpf.replace(/\D/g, "").length !== 11) throw new Error("Informe um CPF válido.");
      if (extNasc.replace(/\D/g, "").length !== 8) throw new Error("Informe a data de nascimento.");
      if (!extContrato) throw new Error("Selecione o contrato.");

      const { data: pre, error: preErr } = await (supabase as any).rpc("sup_ext_prevalidar", {
        p_cpf: extCpf, p_nascimento: extNasc,
      });
      if (preErr) throw preErr;
      if (!pre?.ok) throw new Error(pre?.motivo ?? "Não foi possível validar seus dados.");

      // Confere se já existe conta vinculada — se a edge function falhar por
      // qualquer motivo, segue no fluxo anônimo normalmente (nunca bloqueia).
      let entrouComContaReal = false;
      try {
        const { data: vinculo } = await supabase.functions.invoke("sup-ext-verificar-vinculo", {
          body: { cpf: extCpf, nascimento: extNasc },
        });
        if (vinculo?.linked && vinculo.email && vinculo.token_hash) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            email: vinculo.email,
            token_hash: vinculo.token_hash,
            type: "magiclink",
          });
          if (!otpError) entrouComContaReal = true;
        }
      } catch {
        // segue pro fluxo anônimo abaixo
      }

      if (!entrouComContaReal) {
        const { error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) {
          if (/anonymous/i.test(anonError.message)) {
            throw new Error(
              "Acesso externo desativado no servidor. Peça ao administrador para habilitar " +
              "'Anonymous sign-ins' em Authentication → Providers no Supabase.",
            );
          }
          throw anonError;
        }
      }

      const { error: rpcError } = await (supabase as any).rpc("sup_ext_entrar_empregado", {
        p_cpf: extCpf, p_nascimento: extNasc, p_contrato_id: extContrato,
      });
      // Sessão sem vínculo não serve para nada — desfaz antes de reportar.
      // Numa conta real, "desfazer" é só sair; a conta em si não é apagada.
      if (rpcError) {
        await supabase.auth.signOut();
        throw rpcError;
      }

      disableDemo();
      navigate(ROTAS_EXTERNO[0]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
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
            {aba === "colaborador"
              ? "Use suas credenciais corporativas para acessar o ERP."
              : "Acesso de campo para encarregados solicitarem materiais."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {aba === "colaborador"
              ? "Novos acessos são criados pelo administrador do sistema."
              : "Informe sua identificação e o contrato em que você trabalha."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/50 p-1">
            {([
              ["colaborador", "Colaborador"],
              ["externo", "Externo"],
            ] as [Aba, string][]).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setAba(id); setError(null); }}
                className={
                  "h-9 rounded-md text-sm font-semibold transition-colors " +
                  (aba === id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {rotulo}
              </button>
            ))}
          </div>

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

          {aba === "externo" ? (
            <form onSubmit={handleExterno} className="mt-6 space-y-4">
              <Field label="CPF" icon={<Users2 className="h-4 w-4" />}>
                <input
                  required
                  inputMode="numeric"
                  value={extCpf}
                  onChange={(e) => setExtCpf(mascararCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </Field>

              <Field label="Data de nascimento" icon={<Lock className="h-4 w-4" />}>
                <input
                  required
                  inputMode="numeric"
                  value={extNasc}
                  onChange={(e) => setExtNasc(mascararData(e.target.value))}
                  placeholder="DD/MM/AAAA"
                  className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </Field>

              <Field label="Contrato" icon={<Briefcase className="h-4 w-4" />}>
                <select
                  required
                  value={extContrato}
                  onChange={(e) => setExtContrato(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">
                    {carregandoContratos ? "Carregando…" : "Selecione o contrato"}
                  </option>
                  {contratosExternos.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </Field>

              {!carregandoContratos && contratosExternos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum contrato liberado ainda. O time de Compras precisa cadastrar e aprovar
                  os postos do contrato antes que ele apareça aqui.
                </p>
              )}

              <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                Seus dados são conferidos no cadastro de colaboradores. Se você foi desligado
                ou os dados não baterem, o acesso não é liberado — procure o RH.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="btn-relief group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-accent text-sm font-semibold text-accent-foreground transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? "Aguarde…" : "Entrar"}
                {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                Você verá apenas a área de solicitação de materiais do seu contrato.
              </p>
            </form>
          ) : (
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
          )}

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
