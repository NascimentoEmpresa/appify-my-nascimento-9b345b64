import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff, IdCard, Lock, ShieldCheck } from "lucide-react";
import logoGN from "@/assets/logo-grupo-nascimento.png";
import { chamarPortal, guardarSessao, lerToken, type RespostaLogin } from "@/hooks/useColaboradorPortal";

// =====================================================================
// PORTAL DO COLABORADOR — entrar (/colaborador/entrar)
//
// Login = CPF, senha = CPF (o pedido). A senha inicial é o próprio CPF; a
// pessoa pode trocar por uma própria em Perfil › Segurança, e aí o CPF
// deixa de valer como senha. Quem confere é col_login, via Edge Function —
// nada de Supabase Auth aqui (ver useColaboradorPortal.ts).
// =====================================================================

const maskCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

export default function EntrarColaborador() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const expirada = params.get("expirada") === "1";

  if (lerToken()) return <Navigate to="/colaborador" replace />;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (cpf.replace(/\D/g, "").length !== 11) { setErro("Informe o CPF completo (11 dígitos)."); return; }
    setCarregando(true);
    try {
      const r = await chamarPortal<RespostaLogin>("login", { cpf, senha });
      if (!r.ok || !r.token) { setErro(r.error ?? "CPF ou senha inválidos."); return; }
      guardarSessao(r.token, r.nome ?? "");
      navigate("/colaborador", { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível entrar agora.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="bg-gradient-hero px-6 pb-10 pt-10 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 p-1.5 ring-1 ring-white/20">
            <img src={logoGN} alt="Grupo Nascimento" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="font-display text-base font-bold leading-tight">Grupo Nascimento</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">Portal do Colaborador</p>
          </div>
        </div>
        <h1 className="mx-auto mt-6 max-w-md font-display text-2xl font-bold leading-tight">
          Seu perfil, seu ponto, seu salário e seus treinamentos — num lugar só.
        </h1>
      </div>

      <section className="mx-auto -mt-5 w-full max-w-md px-4 pb-10">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-lg">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-success" /> Acesso pessoal
          </div>
          <h2 className="font-display text-xl font-bold">Entrar com CPF</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use o seu CPF como login e como senha. Se você já trocou a senha, use a nova.
          </p>

          {expirada && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>Sua sessão expirou. Entre de novo para continuar.</p>
            </div>
          )}
          {erro && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{erro}</p>
            </div>
          )}

          <form onSubmit={entrar} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">CPF</span>
              <div className="relative">
                <IdCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  inputMode="numeric"
                  autoComplete="username"
                  required
                  value={cpf}
                  onChange={(e) => setCpf(maskCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  className="h-12 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-base shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">Senha</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={verSenha ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Seu CPF (ou a senha que você criou)"
                  className="h-12 w-full rounded-lg border border-border bg-background pl-10 pr-10 text-base shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                >
                  {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={carregando}
              className="btn-relief group flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-accent text-sm font-semibold text-accent-foreground transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {carregando ? "Entrando…" : "Entrar"}
              {!carregando && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            Não conseguiu entrar? Só entra quem está ativo no cadastro do RH. Se o seu CPF não for aceito,
            procure o RH da sua unidade.
          </p>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">© {new Date().getFullYear()} Grupo Nascimento</p>
      </section>
    </div>
  );
}
