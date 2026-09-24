import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clock3, GraduationCap, History, Home, LogOut, UserRound, Wallet } from "lucide-react";
import logoGN from "@/assets/logo-nascimento-icon.png";
import { cn } from "@/lib/utils";
import {
  EVENTO_SESSAO_EXPIRADA, chamarPortal, lerNomeSalvo, lerToken, limparSessao, primeiroNomeBonito, usePerfilColaborador,
  type PerfilColaborador,
} from "@/hooks/useColaboradorPortal";
import { Carregando, Erro } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — a casca de /colaborador
//
// Fora do AppShell e fora do ProtectedRoute de propósito: quem entra aqui
// não tem sessão do Supabase Auth (ver useColaboradorPortal.ts). A guarda é
// o token do portal no localStorage — sem ele, vai para /colaborador/entrar.
// Se a Edge Function responder 401 (token vencido/revogado), o helper apaga
// o token e dispara EVENTO_SESSAO_EXPIRADA; aqui a gente ouve e redireciona.
//
// Layout pensado para celular: cabeçalho fixo com o nome, conteúdo em coluna
// e barra de navegação embaixo (no desktop ela vira uma barra no topo).
// =====================================================================

interface SessaoColaborador {
  perfil: PerfilColaborador;
  primeiroNome: string;
  sair: () => Promise<void>;
}
const Ctx = createContext<SessaoColaborador | null>(null);

export function useSessaoColaborador(): SessaoColaborador {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSessaoColaborador só dentro do ColaboradorShell");
  return c;
}

const ITENS = [
  { para: "/colaborador", rotulo: "Início", icone: Home, exato: true },
  { para: "/colaborador/ponto", rotulo: "Ponto", icone: Clock3 },
  { para: "/colaborador/treinamentos", rotulo: "Cursos", icone: GraduationCap },
  { para: "/colaborador/salario", rotulo: "Salário", icone: Wallet },
  { para: "/colaborador/perfil", rotulo: "Perfil", icone: UserRound },
];

export default function ColaboradorShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const token = lerToken();

  useEffect(() => {
    const aoExpirar = () => {
      qc.removeQueries({ queryKey: ["colaborador"] });
      navigate("/colaborador/entrar?expirada=1", { replace: true });
    };
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
  }, [navigate, qc]);

  if (!token) return <Navigate to="/colaborador/entrar" replace state={{ de: location.pathname }} />;
  return <ShellAutenticado />;
}

function ShellAutenticado() {
  const location = useLocation();
  // Tela do curso (24/09/2026): o vídeo precisa de largura — max-w-3xl deixava
  // o player com ~360px ao lado da lista de aulas. Só ela abre para 7xl.
  const largo = /^\/colaborador\/treinamentos\/[^/]+\/?$/.test(location.pathname);
  const largura = largo ? "max-w-7xl" : "max-w-3xl";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const perfilQ = usePerfilColaborador();

  const sair = useCallback(async () => {
    await chamarPortal("logout").catch(() => undefined);
    limparSessao();
    qc.removeQueries({ queryKey: ["colaborador"] });
    navigate("/colaborador/entrar", { replace: true });
  }, [navigate, qc]);

  const valor = useMemo<SessaoColaborador | null>(() => {
    if (!perfilQ.data) return null;
    const nome = perfilQ.data.nome ?? lerNomeSalvo() ?? "";
    return { perfil: perfilQ.data, primeiroNome: primeiroNomeBonito(nome), sair };
  }, [perfilQ.data, sair]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className={cn("mx-auto flex h-14 items-center gap-3 px-4", largura)}>
          <img src={logoGN} alt="Grupo Nascimento" className="h-8 w-8 object-contain" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{valor ? `Olá, ${valor.primeiroNome}` : "Portal do Colaborador"}</p>
            <p className="truncate text-[11px] text-muted-foreground">{valor?.perfil.cargo ?? "Grupo Nascimento"}</p>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {ITENS.map((it) => (
              <NavLink
                key={it.para}
                to={it.para}
                end={it.exato}
                className={({ isActive }) =>
                  cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <it.icone className="h-4 w-4" /> {it.rotulo}
              </NavLink>
            ))}
            <NavLink
              to="/colaborador/historico"
              className={({ isActive }) =>
                cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              <History className="h-4 w-4" /> Histórico
            </NavLink>
          </nav>
          <button
            type="button"
            onClick={sair}
            title="Sair"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className={cn("mx-auto w-full flex-1 px-4 pb-24 pt-4 md:pb-8", largura)}>
        {perfilQ.isLoading && <Carregando texto="Abrindo seu painel…" />}
        {perfilQ.isError && !perfilQ.data && (
          <Erro erro={perfilQ.error} acao={<button className="text-sm font-semibold underline" onClick={() => perfilQ.refetch()}>Tentar de novo</button>} />
        )}
        {valor && (
          <Ctx.Provider value={valor}>
            <Outlet />
          </Ctx.Provider>
        )}
      </main>

      {/* Barra inferior — só no celular */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {ITENS.map((it) => (
            <NavLink
              key={it.para}
              to={it.para}
              end={it.exato}
              className={({ isActive }) =>
                cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  isActive ? "text-primary" : "text-muted-foreground")
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("grid h-7 w-10 place-items-center rounded-full", isActive && "bg-primary/10")}>
                    <it.icone className="h-[18px] w-[18px]" />
                  </span>
                  {it.rotulo}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
