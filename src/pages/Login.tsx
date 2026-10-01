import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Lock, Mail, ShieldCheck, AlertCircle, ArrowRight, Eye, EyeOff, CheckCircle2, Loader2,
  Crown, Network, Gavel, PieChart, Wallet, BookOpen, Package, FileSignature, Users, Scale, HardHat,
  ListChecks, GraduationCap, Receipt, BarChart3, Settings, ClipboardList, UserSearch, Truck, MonitorCog,
  Headphones, MessageCircle, Inbox, Building2, type LucideIcon,
} from "lucide-react";
import logoBranco from "@/assets/logo-nascimento-branco.webp";
import logoCompleto from "@/assets/logo-nascimento-completo.webp";
import bigodinho from "@/assets/bigodinho-em-pe.webp";
import { useDemoMode } from "@/context/DemoModeContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROTAS_EXTERNO } from "@/hooks/useModoExterno";

// =====================================================================
// LOGIN (redesenho 01/10/2026)
//
// Pedido do Pablo: "dá uma melhorada na animação, atualiza a logo, os status
// dos módulos que tem BEM MAIS agora e tá tudo desenvolvido (...) se baseia
// no site da carmed (carmed-bay.vercel.app), qualidade extrema".
//
// Da Carmed vieram: a palavra gigante ao fundo com um objeto flutuando na
// frente (lá o tubo de gel; aqui o ARCO do logo, desenhado em SVG e
// "traçado" na entrada), peças em volta com profundidade que seguem o mouse
// (parallax), título com ponto final colorido, eyebrow com bolinha e
// botão em pílula. Nas cores do ERP (marinho + laranja do logo).
//
// O painel antigo listava 6 módulos com 5 "EM BREVE" (de quando só
// Licitações existia). Agora: os 25 módulos ativos de app_modulo, todos no
// ar, numa esteira dupla. A lista é ESTÁTICA de propósito — o login roda
// sem sessão e app_modulo exige autenticado; módulo novo → 1 linha em
// MODULOS abaixo.
//
// 01/10 (mesmo dia): o personagem da empresa (o "bigodinho", em pé, mãos na
// cintura) entrou no centro do palco, na frente da palavra — ele é o
// "produto" da Carmed agora; o arco foi para trás da cabeça, como auréola.
// Sobe na entrada, respira parado e dá um pulinho quando o mouse passa.
//
// Logo: o arquivo branco (logo-nascimento-branco.webp, 2000×1271 com
// transparência) tem margem grande; o recorte é por CSS (LogoBranco), com
// as medidas do contorno real medidas no canvas (x/y 217, 1566×837).
//
// prefers-reduced-motion: só param os movimentos contínuos (ver o fim do CSS).
// =====================================================================

const MODULOS: { nome: string; icone: LucideIcon }[] = [
  { nome: "Presidência", icone: Crown },
  { nome: "Diretoria", icone: Building2 },
  { nome: "Organograma", icone: Network },
  { nome: "Licitações", icone: Gavel },
  { nome: "Contratos", icone: FileSignature },
  { nome: "Controladoria & Orçamento", icone: PieChart },
  { nome: "Financeiro", icone: Wallet },
  { nome: "Contábil", icone: BookOpen },
  { nome: "Fiscal", icone: Receipt },
  { nome: "Suprimentos", icone: Package },
  { nome: "RH", icone: Users },
  { nome: "Recrutamento e Seleção", icone: UserSearch },
  { nome: "Treinamentos", icone: GraduationCap },
  { nome: "Jurídico", icone: Scale },
  { nome: "SST", icone: HardHat },
  { nome: "Plano de Ações", icone: ListChecks },
  { nome: "Operacional", icone: Truck },
  { nome: "Encarregados", icone: ClipboardList },
  { nome: "Central de Serviços", icone: Headphones },
  { nome: "Malote", icone: Inbox },
  { nome: "WhatsApp", icone: MessageCircle },
  { nome: "Comitê de Ética", icone: ShieldCheck },
  { nome: "Sistemas", icone: MonitorCog },
  { nome: "BI", icone: BarChart3 },
  { nome: "Administração", icone: Settings },
];
const TOTAL_TELAS = 240; // app_menu com rota, ativos (01/10/2026: 242)

// A palavra gigante do fundo troca sozinha (na Carmed é o sabor).
const PALAVRAS = ["Gestão", "Pessoas", "Contratos", "Resultados", "Equipe"];

// Peças flutuando em volta do arco — `d` é a profundidade do parallax.
const PECAS: { m: number; x: string; y: string; d: number; atraso: number }[] = [
  { m: 3, x: "6%", y: "14%", d: 26, atraso: 0 },
  { m: 11, x: "70%", y: "6%", d: 18, atraso: 1.2 },
  { m: 18, x: "3%", y: "66%", d: 14, atraso: 0.6 },
  { m: 6, x: "73%", y: "64%", d: 30, atraso: 1.8 },
];

export default function Login() {
  const [showPwd, setShowPwd] = useState(false);
  // "Lembrar meu e-mail": só o e-mail, no navegador da pessoa (nunca a senha).
  const [email, setEmail] = useState(() => lerEmailLembrado());
  const [lembrar, setLembrar] = useState(() => !!lerEmailLembrado());
  const [capsLock, setCapsLock] = useState(false);
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
      gravarEmailLembrado(lembrar ? email.trim() : null);
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

  const atraso = (s: number): CSSProperties => ({ animationDelay: `${s}s` });
  const verCaps = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  const hora = new Date().getHours();
  const saudacao = hora < 5 ? "Boa noite" : hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="lg-raiz grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
      <style>{CSS_LOGIN}</style>
      <PainelMarca />

      {/* Formulário */}
      <section className="lg-form relative flex items-center justify-center overflow-hidden bg-background p-5 sm:p-8 lg:p-12">
        <div className="lg-form-pontos" aria-hidden />
        <div className="lg-form-bolha" aria-hidden />
        <div className="lg-form-bolha lg-form-bolha-2" aria-hidden />

        <div className="relative w-full max-w-[440px]">
          <div className="lg-sobe mb-8 flex justify-center lg:hidden" style={atraso(0)}>
            <img src={logoCompleto} alt="Nascimento — soluções em serviços" className="h-12 w-auto" />
          </div>

          <div className="lg-cartao lg-sobe relative overflow-hidden rounded-[28px] border border-border/70 bg-card/85 p-7 backdrop-blur-xl sm:p-9" style={atraso(0.05)}>
            <div className="lg-cartao-faixa" aria-hidden />

            <div className="flex items-center justify-between gap-3">
              <span className="lg-sobe inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" style={atraso(0.12)}>
                <ShieldCheck className="h-3 w-3 text-success" /> Acesso restrito
              </span>
              <span className="lg-sobe hidden items-center gap-2 text-[11px] font-medium text-muted-foreground sm:inline-flex" style={atraso(0.12)}>
                <span className="lg-ponto-vivo lg-ponto-vivo-p" /> Sistema operando
              </span>
            </div>

            <h2 className="lg-sobe mt-5 font-display text-[2rem] font-extrabold leading-[1.08] tracking-tight" style={atraso(0.18)}>
              Bem-vindo de volta<span className="text-accent">.</span>
            </h2>
            <p className="lg-sobe mt-2 text-sm leading-relaxed text-muted-foreground" style={atraso(0.22)}>
              {saudacao}! Use suas credenciais corporativas para acessar o ERP.
            </p>

            {sessionExpired && (
              <div className="lg-sobe mt-5 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p><span className="font-semibold text-amber-700">Sessão expirada.</span> Por inatividade, sua sessão foi encerrada automaticamente. Faça login novamente para continuar.</p>
              </div>
            )}

            {successMsg && (
              <div className="lg-sobe mt-5 flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <p>{successMsg}</p>
              </div>
            )}

            {error && (
              <div key={error} className="lg-treme mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div className="lg-sobe" style={atraso(0.28)}>
                <Field label="E-mail corporativo" icon={<Mail className="h-4 w-4" />}>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome.sobrenome@gruponascimento.com.br"
                    className="lg-input h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-3 text-sm"
                  />
                </Field>
              </div>

              <div className="lg-sobe" style={atraso(0.33)}>
                <Field
                  label="Senha"
                  icon={<Lock className="h-4 w-4" />}
                  right={
                    <Link to="/esqueci-senha" className="text-xs font-medium text-muted-foreground transition-colors hover:text-accent">
                      Esqueci minha senha
                    </Link>
                  }
                >
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={verCaps}
                    onKeyUp={verCaps}
                    onBlur={() => setCapsLock(false)}
                    placeholder="••••••••••••"
                    className="lg-input h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-11 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? "Esconder senha" : "Mostrar senha"}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </Field>
                {capsLock && (
                  <p className="lg-aparece mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                    <AlertCircle className="h-3.5 w-3.5" /> Caps Lock está ativado
                  </p>
                )}
              </div>

              <label className="lg-sobe flex w-fit cursor-pointer select-none items-center gap-2.5 text-[13px] text-muted-foreground" style={atraso(0.37)}>
                <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="lg-check" />
                Lembrar meu e-mail neste computador
              </label>

              <div className="lg-sobe" style={atraso(0.41)}>
                <button
                  type="submit"
                  disabled={loading}
                  className="lg-botao group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-accent text-sm font-bold text-accent-foreground shadow-[0_14px_30px_-12px_hsl(22_95%_50%/0.7)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_38px_-14px_hsl(22_95%_50%/0.85)] active:translate-y-0 disabled:opacity-70"
                >
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Entrando…</> : <>Entrar na plataforma <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" /></>}
                </button>
              </div>
            </form>

            <div className="lg-sobe mt-7 flex items-start gap-3 border-t border-border/70 pt-5 text-[11.5px] leading-relaxed text-muted-foreground" style={atraso(0.47)}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-4 w-4" /></span>
              <p>
                <span className="font-semibold text-foreground">Acesso monitorado.</span> Toda autenticação é registrada com data, hora, IP e
                dispositivo; atividades suspeitas acionam bloqueio automático e auditoria.
              </p>
            </div>
          </div>

          <p className="lg-sobe mt-5 text-center text-[11px] text-muted-foreground" style={atraso(0.55)}>
            Novos acessos são criados pelo administrador do sistema.
          </p>
        </div>
      </section>
    </div>
  );
}

// "Lembrar meu e-mail" — só o e-mail, no localStorage deste navegador.
// Acesso em try/catch: aba anônima ou site com dados bloqueados joga erro.
const CHAVE_EMAIL = "erp.login.email";
function lerEmailLembrado(): string {
  try { return localStorage.getItem(CHAVE_EMAIL) ?? ""; } catch { return ""; }
}
function gravarEmailLembrado(email: string | null) {
  try { if (email) localStorage.setItem(CHAVE_EMAIL, email); else localStorage.removeItem(CHAVE_EMAIL); } catch { /* sem armazenamento: segue sem lembrar */ }
}

// ── Painel da marca (lado esquerdo, só desktop) ─────────────────────────

function PainelMarca() {
  const ref = useRef<HTMLElement>(null);
  const raf = useRef(0);
  const [palavra, setPalavra] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setPalavra((p) => (p + 1) % PALAVRAS.length), 3200);
    return () => window.clearInterval(t);
  }, []);

  // Parallax: o mouse vira --mx/--my (-1..1) no painel; cada peça anda na sua profundidade.
  const mover = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const my = ((e.clientY - r.top) / r.height) * 2 - 1;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", mx.toFixed(3));
      el.style.setProperty("--my", my.toFixed(3));
    });
  };
  const sair = () => { ref.current?.style.setProperty("--mx", "0"); ref.current?.style.setProperty("--my", "0"); };

  const metade = Math.ceil(MODULOS.length / 2);
  const fileiras = [MODULOS.slice(0, metade), MODULOS.slice(metade)];

  return (
    <aside ref={ref} onMouseMove={mover} onMouseLeave={sair}
      className="lg-painel relative hidden overflow-hidden text-white lg:flex lg:flex-col">
      <div className="lg-pontos" aria-hidden />
      <div className="lg-luz lg-luz-1" aria-hidden />
      <div className="lg-luz lg-luz-2" aria-hidden />

      {/* Topo */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-12 pt-10">
        <div className="lg-sobe" style={{ animationDelay: "0s" }}><LogoBranco largura={168} /></div>
        <span className="lg-sobe inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/85 backdrop-blur" style={{ animationDelay: ".1s" }}>
          <span className="lg-ponto-vivo" /> Todos os módulos no ar
        </span>
      </div>

      {/* Palco: palavra gigante + arco flutuando + peças */}
      <div className="lg-palco relative z-0 min-h-[230px] flex-1">
        <div className="lg-palavra-caixa" aria-hidden>
          <span key={palavra} className="lg-palavra">{PALAVRAS[palavra]}</span>
        </div>

        {PECAS.map((p, i) => {
          const m = MODULOS[p.m];
          return (
            <div key={m.nome} className="lg-peca-pos" style={{ left: p.x, top: p.y, "--d": p.d } as CSSProperties} aria-hidden>
              <div className="lg-peca" style={{ animationDelay: `${0.7 + i * 0.12}s, ${p.atraso}s` }}>
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/12 text-white"><m.icone className="h-4 w-4" /></span>
                <span className="leading-tight">
                  <span className="block text-[12px] font-bold">{m.nome}</span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> No ar</span>
                </span>
              </div>
            </div>
          );
        })}

        <div className="lg-arco-pos" aria-hidden>
          <div className="lg-arco-flutua">
            <ArcoLogo />
          </div>
        </div>

        <div className="lg-boneco-pos">
          <div className="lg-boneco-sombra" aria-hidden />
          <img src={bigodinho} alt="Mascote do Grupo Nascimento" draggable={false} className="lg-boneco" />
        </div>
      </div>

      {/* Texto + números + esteira */}
      <div className="relative z-10 px-12 pb-9">
        <p className="lg-sobe mb-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70" style={{ animationDelay: ".35s" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> ERP corporativo multi-CNPJ
        </p>
        <h1 className="lg-sobe max-w-xl font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-tight" style={{ animationDelay: ".42s" }}>
          Gestão integrada do Grupo Nascimento<span className="text-accent">.</span>
        </h1>

        <div className="lg-sobe mt-6 flex gap-8" style={{ animationDelay: ".5s" }}>
          <Numero alvo={MODULOS.length} rotulo="módulos ativos" />
          <Numero alvo={TOTAL_TELAS} sufixo="+" rotulo="telas no sistema" />
          <Numero alvo={100} sufixo="%" rotulo="desenvolvido e no ar" />
        </div>

        <div className="lg-sobe lg-esteira mt-7 space-y-2.5" style={{ animationDelay: ".6s" }}>
          {fileiras.map((fila, i) => (
            <div key={i} className="overflow-hidden">
              <div className={"lg-trilho " + (i ? "lg-trilho-volta" : "")}>
                {[...fila, ...fila].map((m, k) => (
                  <span key={k} className="lg-chip" aria-hidden={k >= fila.length}>
                    <m.icone className="h-3.5 w-3.5 text-accent" /> {m.nome}
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-7 text-[11px] text-white/45">© {new Date().getFullYear()} Grupo Nascimento — soluções em serviços · Todos os direitos reservados</p>
      </div>
    </aside>
  );
}

function Numero({ alvo, sufixo = "", rotulo }: { alvo: number; sufixo?: string; rotulo: string }) {
  const v = useContagem(alvo, 900);
  return (
    <div>
      <p className="font-display text-3xl font-extrabold tabular-nums leading-none">
        {v}<span className="text-accent">{sufixo}</span>
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-white/55">{rotulo}</p>
    </div>
  );
}

/** Conta de 0 até `alvo` (ease-out), começando depois de `espera` ms. */
function useContagem(alvo: number, espera: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let id = 0;
    const t = window.setTimeout(() => {
      const ini = performance.now(); const dur = 1400;
      const passo = (agora: number) => {
        const p = Math.min(1, (agora - ini) / dur);
        setV(Math.round(alvo * (1 - Math.pow(1 - p, 3))));
        if (p < 1) id = requestAnimationFrame(passo);
      };
      id = requestAnimationFrame(passo);
    }, espera);
    return () => { window.clearTimeout(t); cancelAnimationFrame(id); };
  }, [alvo, espera]);
  return v;
}

/** Logo branco recortado: o arquivo tem 2000×1271 e o desenho ocupa (217,217)–(1783,1054). */
function LogoBranco({ largura }: { largura: number }) {
  const k = largura / 1566;
  return (
    <div style={{ width: largura, height: Math.round(837 * k), overflow: "hidden" }}>
      <img src={logoBranco} alt="Nascimento — soluções em serviços" draggable={false}
        style={{ width: 2000 * k, maxWidth: "none", marginLeft: -217 * k, marginTop: -217 * k, display: "block" }} />
    </div>
  );
}

/**
 * O arco do logo em SVG, nas medidas do arquivo original (2000×1271):
 * anel de centro (1000,624), raio externo 407 e interno 329 (espessura 78),
 * cortado em y=555, mais a haste (600..678 × 295..555) que faz a "seta".
 * Na entrada o anel é traçado da direita para a esquerda (o sentido da
 * seta) e a haste sobe em seguida.
 */
function ArcoLogo() {
  return (
    <svg viewBox="590 205 822 360" className="lg-arco" role="img" aria-label="Símbolo Nascimento">
      <defs>
        <clipPath id="lg-corte"><rect x="0" y="0" width="2000" height="555" /></clipPath>
        <linearGradient id="lg-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff9a4d" />
          <stop offset="55%" stopColor="#ea670b" />
          <stop offset="100%" stopColor="#d9530a" />
        </linearGradient>
      </defs>
      <g clipPath="url(#lg-corte)">
        <path className="lg-arco-traco" d="M1368,640 A368,368 0 0 0 632,640" fill="none" stroke="url(#lg-grad)" strokeWidth="78" pathLength={1} />
      </g>
      <rect className="lg-arco-haste" x="600" y="295" width="78" height="260" fill="url(#lg-grad)" />
    </svg>
  );
}

function Field({
  label, icon, right, children,
}: { label: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[13px] font-semibold text-foreground">{label}</label>
        {right}
      </div>
      <div className="lg-campo relative">
        <span className="lg-campo-icone pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors">{icon}</span>
        {children}
      </div>
    </div>
  );
}

const CSS_LOGIN = `
.lg-painel{--mx:0;--my:0;
  background:radial-gradient(1100px 620px at 85% -12%,#1f53bb 0%,transparent 58%),radial-gradient(800px 560px at -12% 112%,#143579 0%,transparent 55%),linear-gradient(160deg,#0f3171 0%,#0b2a63 46%,#061636 100%)}
.lg-pontos{position:absolute;inset:0;opacity:.16;pointer-events:none;
  background-image:radial-gradient(rgba(255,255,255,.45) 1px,transparent 1px);background-size:26px 26px;
  mask-image:radial-gradient(ellipse at 50% 40%,#000 0%,transparent 72%);-webkit-mask-image:radial-gradient(ellipse at 50% 40%,#000 0%,transparent 72%)}
.lg-luz{position:absolute;border-radius:9999px;filter:blur(70px);pointer-events:none;transition:transform .9s cubic-bezier(.2,.7,.2,1)}
.lg-luz-1{width:420px;height:420px;top:12%;left:38%;background:rgba(242,107,29,.22);transform:translate3d(calc(var(--mx)*-40px),calc(var(--my)*-30px),0)}
.lg-luz-2{width:380px;height:380px;bottom:-8%;left:-6%;background:rgba(56,120,255,.22);transform:translate3d(calc(var(--mx)*30px),calc(var(--my)*24px),0)}

/* palavra gigante */
.lg-palavra-caixa{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;pointer-events:none}
.lg-palavra{font-family:"Plus Jakarta Sans",Inter,system-ui,sans-serif;font-weight:800;letter-spacing:-.05em;line-height:1;white-space:nowrap;
  font-size:clamp(96px,11.5vw,210px);
  background:linear-gradient(180deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,.05) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  transform:translate3d(calc(var(--mx)*-12px),calc(var(--my)*-8px),0);
  animation:lg-palavra 3.2s cubic-bezier(.2,.7,.2,1) both}
@keyframes lg-palavra{0%{opacity:0;filter:blur(14px);letter-spacing:.02em}14%{opacity:1;filter:blur(0);letter-spacing:-.05em}86%{opacity:1;filter:blur(0)}100%{opacity:0;filter:blur(10px)}}

/* arco do logo, o "produto" do palco */
.lg-arco-pos{position:absolute;left:50%;top:34%;width:min(50%,380px);transform:translate3d(calc(-50% + var(--mx)*22px),calc(-50% + var(--my)*16px),0);transition:transform .7s cubic-bezier(.2,.7,.2,1)}
.lg-arco-flutua{animation:lg-flutua 6s ease-in-out 2.2s infinite}
.lg-arco{display:block;width:100%;height:auto;overflow:visible;filter:drop-shadow(0 18px 30px rgba(242,107,29,.45)) drop-shadow(0 0 60px rgba(242,107,29,.25))}
.lg-arco-traco{stroke-dasharray:1;stroke-dashoffset:1;animation:lg-traca 1.4s cubic-bezier(.65,0,.25,1) .35s forwards}
.lg-arco-haste{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0);animation:lg-haste .55s cubic-bezier(.2,.9,.25,1.25) 1.6s forwards}
/* o personagem, na frente da palavra e do arco */
.lg-boneco-pos{position:absolute;left:50%;bottom:3%;height:94%;z-index:2;transform:translate3d(calc(-50% + var(--mx)*10px),calc(var(--my)*5px),0);transition:transform .7s cubic-bezier(.2,.7,.2,1)}
.lg-boneco{position:relative;display:block;height:100%;width:auto;max-width:none;user-select:none;cursor:pointer;transform-origin:50% 100%;
  filter:drop-shadow(0 22px 26px rgba(2,8,28,.45));
  animation:lg-boneco-entra .95s cubic-bezier(.2,.9,.25,1.15) 1s both,lg-respira 4.8s ease-in-out 2.2s infinite}
.lg-boneco-pos:hover .lg-boneco{animation:lg-pulo .7s cubic-bezier(.3,.7,.3,1) both}
.lg-boneco-sombra{position:absolute;left:-30%;right:-30%;bottom:-8px;height:26px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(0,0,0,.5),transparent);animation:lg-sombra-entra .95s ease-out 1s both}
@keyframes lg-boneco-entra{from{opacity:0;transform:translateY(60px) scale(.9)}to{opacity:1;transform:none}}
@keyframes lg-respira{0%,100%{transform:scale(1,1) rotate(0)}50%{transform:scale(1.008,1.014) rotate(-.6deg)}}
@keyframes lg-pulo{0%{transform:none}25%{transform:scale(1.04,.94)}55%{transform:translateY(-26px) scale(.98,1.04)}80%{transform:translateY(0) scale(1.03,.96)}100%{transform:none}}
@keyframes lg-sombra-entra{from{opacity:0}to{opacity:1}}
.lg-boneco-pos:hover .lg-boneco-sombra{animation:lg-sombra-pulo .7s cubic-bezier(.3,.7,.3,1) both}
@keyframes lg-sombra-pulo{55%{transform:scale(.7);opacity:.5}}
@keyframes lg-traca{to{stroke-dashoffset:0}}
@keyframes lg-haste{to{transform:scaleY(1)}}
@keyframes lg-flutua{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-14px) rotate(-1.5deg)}}
@keyframes lg-sombra{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.82);opacity:.6}}

/* peças em volta */
.lg-peca-pos{position:absolute;transform:translate3d(calc(var(--mx)*var(--d)*1px),calc(var(--my)*var(--d)*1px),0);transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.lg-peca{display:flex;align-items:center;gap:10px;padding:9px 14px 9px 9px;border-radius:16px;
  background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.05));border:1px solid rgba(255,255,255,.16);
  box-shadow:0 18px 40px -18px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  opacity:0;animation:lg-entra .8s cubic-bezier(.2,.8,.2,1) forwards,lg-boia 7s ease-in-out infinite}
@keyframes lg-entra{from{opacity:0;transform:translateY(18px) scale(.94)}to{opacity:1;transform:none}}
@keyframes lg-boia{0%,100%{translate:0 0}50%{translate:0 -10px}}

/* status vivo */
.lg-ponto-vivo{position:relative;width:8px;height:8px;border-radius:9999px;background:#34d399}
.lg-ponto-vivo::after{content:"";position:absolute;inset:0;border-radius:inherit;background:#34d399;animation:lg-pulso 1.8s ease-out infinite}
@keyframes lg-pulso{from{transform:scale(1);opacity:.7}to{transform:scale(3);opacity:0}}

/* esteira de módulos */
.lg-esteira{mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.lg-trilho{display:flex;width:max-content;gap:8px;animation:lg-esteira 48s linear infinite}
.lg-trilho-volta{animation-direction:reverse;animation-duration:56s}
.lg-esteira:hover .lg-trilho{animation-play-state:paused}
@keyframes lg-esteira{to{transform:translateX(calc(-50% - 4px))}}
.lg-chip{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;padding:7px 12px;border-radius:9999px;font-size:12px;font-weight:600;color:rgba(255,255,255,.88);
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.11);transition:background .25s,border-color .25s}
.lg-chip:hover{background:rgba(255,255,255,.12);border-color:rgba(242,107,29,.5)}

/* entrada em cascata */
.lg-sobe{opacity:0;animation:lg-sobe .75s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes lg-sobe{from{opacity:0;transform:translateY(16px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}

/* formulário */
.lg-form-pontos{position:absolute;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(hsl(var(--muted-foreground)/.18) 1px,transparent 1px);background-size:22px 22px;
  mask-image:radial-gradient(ellipse at 50% 50%,#000 0%,transparent 68%);-webkit-mask-image:radial-gradient(ellipse at 50% 50%,#000 0%,transparent 68%)}
.lg-form-bolha{position:absolute;width:520px;height:520px;right:-180px;top:-200px;border-radius:9999px;filter:blur(60px);pointer-events:none;
  background:radial-gradient(closest-side,hsl(22 95% 54%/.16),transparent);animation:lg-bolha 14s ease-in-out infinite alternate}
.lg-form-bolha-2{right:auto;top:auto;left:-220px;bottom:-240px;background:radial-gradient(closest-side,hsl(218 78% 40%/.13),transparent);animation-duration:18s;animation-direction:alternate-reverse}
.lg-cartao{box-shadow:0 1px 0 hsl(0 0% 100%/.6) inset,0 40px 80px -40px hsl(218 78% 22%/.35),0 12px 24px -16px hsl(218 78% 22%/.18)}
.lg-cartao-faixa{position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#0f3171,#2a5bd7,#f26b1d,#ff9a4d,#0f3171);background-size:200% 100%;animation:lg-faixa 8s linear infinite}
@keyframes lg-faixa{to{background-position:-200% 0}}
.lg-ponto-vivo-p{width:7px;height:7px}
.lg-aparece{animation:lg-sobe .3s ease-out both}
.lg-check{appearance:none;-webkit-appearance:none;width:17px;height:17px;border-radius:6px;border:1.5px solid hsl(var(--border));background:hsl(var(--background));
  display:grid;place-items:center;cursor:pointer;transition:background .2s,border-color .2s,box-shadow .2s;flex-shrink:0;margin:0}
.lg-check::after{content:"";width:9px;height:5px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:translateY(-1px) rotate(-45deg) scale(0);transition:transform .2s cubic-bezier(.3,1.6,.5,1)}
.lg-check:checked{background:hsl(var(--accent));border-color:hsl(var(--accent))}
.lg-check:checked::after{transform:translateY(-1px) rotate(-45deg) scale(1)}
.lg-check:focus-visible{box-shadow:0 0 0 4px hsl(var(--accent)/.18)}
/* o navegador pinta de azul o campo preenchido sozinho — devolve a cor do tema */
.lg-input:-webkit-autofill,.lg-input:-webkit-autofill:hover{-webkit-box-shadow:0 0 0 1000px hsl(var(--background)) inset;-webkit-text-fill-color:hsl(var(--foreground));caret-color:hsl(var(--foreground));transition:background-color 99999s}
.lg-input:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 1000px hsl(var(--background)) inset,0 0 0 4px hsl(var(--accent)/.14)}
@keyframes lg-bolha{to{transform:translate(-60px,80px) scale(1.1)}}
.lg-input{transition:border-color .2s,box-shadow .25s,background-color .2s;outline:none}
.lg-input{box-shadow:0 1px 2px hsl(218 78% 22%/.05)}
.lg-input:hover{border-color:hsl(var(--muted-foreground)/.35)}
.lg-input:focus{border-color:hsl(var(--accent));box-shadow:0 0 0 4px hsl(var(--accent)/.14),0 8px 20px -12px hsl(var(--accent)/.5)}
.lg-campo:focus-within .lg-campo-icone{color:hsl(var(--accent))}
.lg-botao::after{content:"";position:absolute;inset:0;transform:translateX(-120%) skewX(-20deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:lg-brilho 4.5s ease-in-out 1.6s infinite}
.lg-botao:hover::after{animation-duration:1.2s}
@keyframes lg-brilho{0%{transform:translateX(-120%) skewX(-20deg)}35%,100%{transform:translateX(220%) skewX(-20deg)}}
.lg-treme{animation:lg-treme .45s cubic-bezier(.36,.07,.19,.97)}
@keyframes lg-treme{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(3px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}

/* "Reduzir movimento" (no Windows vem ligado quando as animações do sistema
   estão desligadas — comum em PC corporativo): para só o que balança sem
   parar (flutuar, parallax, bolha). Entradas, traço do arco, contagem, troca
   da palavra e esteira continuam — são curtos ou lentos e laterais. */
@media (prefers-reduced-motion:reduce){
  .lg-arco-flutua,.lg-form-bolha,.lg-cartao-faixa{animation:none!important}
  .lg-boneco{animation:lg-boneco-entra .95s cubic-bezier(.2,.9,.25,1.15) 1s both!important}
  .lg-boneco-sombra{animation:lg-sombra-entra .95s ease-out 1s both!important}
  .lg-peca{animation:lg-entra .8s cubic-bezier(.2,.8,.2,1) forwards!important}
  .lg-peca-pos,.lg-arco-pos,.lg-boneco-pos,.lg-luz,.lg-palavra{transition:none!important}
}
`;
