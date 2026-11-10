import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, Search, X } from "lucide-react";
import { NAV_MODULOS, type NavItemDef, type NavModuleDef } from "@/components/layout/Sidebar";
import { useAccessibleMenus, rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";
import { useAuth } from "@/hooks/useAuth";
import { useMenuLateral } from "@/hooks/useMenuLateral";
import { buscarTelas, trechosDestacados, type TelaBusca } from "@/lib/busca/buscaTelas";
import { cn } from "@/lib/utils";

// =====================================================================
// Barra de busca do topo: acha a tela pelo nome, com erro de digitação ou por
// outro nome (motor em src/lib/busca/buscaTelas.ts). A lista sai do mesmo menu
// organizado da lateral e passa pela mesma regra de acesso: quem não pode abrir
// uma tela não a vê aqui. Busca telas, não registros (edital, contrato...).
// =====================================================================

const MAX_RECENTES = 5;
const chaveRecentes = (uid?: string) => `busca-telas-recentes:${uid ?? "anon"}`;

// Só conveniência: em janela privada o navegador pode recusar, e a busca segue sem recentes.
function lerRecentes(uid?: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(chaveRecentes(uid)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function gravarRecentes(uid: string | undefined, lista: string[]) {
  try { localStorage.setItem(chaveRecentes(uid), JSON.stringify(lista)); } catch { /* sem armazenamento */ }
}

/** As telas que esta pessoa pode abrir, uma por rota. */
function useTelasDaBusca(): TelaBusca[] {
  const { data: access } = useAccessibleMenus("visualizar");
  const modulos = useMenuLateral<NavItemDef, NavModuleDef>(NAV_MODULOS);
  return useMemo(() => {
    const vistos = new Set<string>();
    const telas: TelaBusca[] = [];
    const incluir = (t: TelaBusca) => {
      if (vistos.has(t.to) || !rotaVisivelNoMenu(t.to, access)) return;
      vistos.add(t.to);
      telas.push(t);
    };
    for (const m of modulos) {
      if (m.status !== "active") continue;
      for (const g of m.groups ?? []) for (const i of g.items) incluir({ to: i.to, label: i.label, modulo: m.label, grupo: g.label });
      // Módulo com página própria: "Malote" e "Central de Serviços" também são destino.
      if (m.headerLink && m.headerLink !== "/app") incluir({ to: m.headerLink, label: m.label, modulo: "Módulo" });
    }
    incluir({ to: "/app/meu-perfil", label: "Meu Perfil", modulo: "Meu espaço" });
    incluir({ to: "/app/minhas-tarefas", label: "Minhas Tarefas", modulo: "Meu espaço" });
    incluir({ to: "/app/novidades", label: "Novidades do Sistema", modulo: "Meu espaço" });
    return telas;
  }, [modulos, access]);
}

export function BuscaTelas() {
  const nav = useNavigate();
  const { user } = useAuth();
  const telas = useTelasDaBusca();
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [noCelular, setNoCelular] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [recentes, setRecentes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  useEffect(() => { setRecentes(lerRecentes(user?.id)); }, [user?.id]);

  const buscando = texto.trim().length > 0;
  const resultados = useMemo(() => {
    if (buscando) return buscarTelas(texto, telas, recentes);
    return recentes.flatMap((to) => telas.filter((t) => t.to === to)).map((t) => ({ ...t, pontos: 0, porSinonimo: undefined as string | undefined }));
  }, [texto, buscando, telas, recentes]);

  useEffect(() => { setAtivo(0); }, [texto]);

  // Ctrl+K / ⌘K de qualquer tela.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setNoCelular(window.innerWidth < 768);
        setAberto(true);
        setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: PointerEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) { setAberto(false); setNoCelular(false); }
    };
    document.addEventListener("pointerdown", aoClicar, true);
    return () => document.removeEventListener("pointerdown", aoClicar, true);
  }, [aberto]);

  const fechar = () => { setAberto(false); setNoCelular(false); inputRef.current?.blur(); };

  const abrir = (to: string) => {
    const lista = [to, ...recentes.filter((r) => r !== to)].slice(0, MAX_RECENTES);
    setRecentes(lista);
    gravarRecentes(user?.id, lista);
    setTexto("");
    fechar();
    nav(to);
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); if (texto) setTexto(""); else fechar(); return; }
    if (!resultados.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setAtivo((a) => (a + 1) % resultados.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => (a - 1 + resultados.length) % resultados.length); }
    if (e.key === "Enter") { e.preventDefault(); const r = resultados[ativo]; if (r) abrir(r.to); }
  };

  const ehMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const mostrarLista = aberto && (buscando || resultados.length > 0);

  return (
    <>
      <button type="button" aria-label="Buscar telas" onClick={() => { setNoCelular(true); setAberto(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden">
        <Search className="h-5 w-5" />
      </button>

      <div className={cn("ml-2 flex-1 justify-center md:flex", noCelular ? "absolute inset-x-0 bottom-0 z-30 ml-0 flex h-14 items-center bg-surface px-3 md:h-full" : "hidden")}>
        <div ref={caixaRef} className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={texto}
            role="combobox"
            aria-label="Buscar telas e sistemas"
            aria-expanded={mostrarLista}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={mostrarLista && resultados[ativo] ? `${idLista}-${ativo}` : undefined}
            placeholder="Buscar telas e sistemas · demissão, vaga, férias…"
            onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
            onFocus={() => setAberto(true)}
            onKeyDown={aoTeclar}
            className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-12 text-sm shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 md:h-9 md:pr-16"
          />
          {noCelular || texto ? (
            <button type="button" aria-label={texto ? "Limpar busca" : "Fechar busca"}
              onClick={() => { if (texto) { setTexto(""); inputRef.current?.focus(); } else fechar(); }}
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted md:right-2 md:h-6 md:w-6">
              <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{ehMac ? "⌘K" : "Ctrl K"}</kbd>
          )}

          {mostrarLista && (
            <div className={cn(
              "absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg",
              // Celular: a lista ganha a tela toda abaixo do campo, com os
              // resultados acima do teclado.
              // `fixed` aqui é relativo ao <header> (backdrop-blur), por isso a
              // altura é calculada: um bottom-0 pararia no fim da barra.
              noCelular && "max-md:fixed max-md:top-[var(--topo-mobile)] max-md:mt-0 max-md:h-[calc(100dvh_-_var(--topo-mobile))] max-md:overflow-y-auto max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:shadow-none",
            )}>
              {!buscando && (
                <p className="flex items-center gap-1.5 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="h-3 w-3" /> Abertas recentemente
                </p>
              )}
              <ul id={idLista} role="listbox" aria-label="Resultados da busca" className="max-h-[60vh] overflow-y-auto py-1 max-md:max-h-none">
                {resultados.map((r, i) => (
                  <li key={r.to} id={`${idLista}-${i}`} role="option" aria-selected={i === ativo}
                    onPointerEnter={() => setAtivo(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => abrir(r.to)}
                    className={cn("cursor-pointer px-3 py-2 text-sm max-md:py-3", i === ativo && "bg-muted")}>
                    <span className="block truncate font-medium">
                      {trechosDestacados(r.label, texto).map((p, j) => (
                        <span key={j} className={p.marcado ? "font-bold text-primary" : undefined}>{p.texto}</span>
                      ))}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.modulo, r.grupo].filter(Boolean).join(" › ")}
                      {r.porSinonimo && ` · relacionado a "${r.porSinonimo}"`}
                    </span>
                  </li>
                ))}
              </ul>
              {buscando && resultados.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  Nenhuma tela encontrada para "{texto.trim()}" entre as que você pode acessar.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
