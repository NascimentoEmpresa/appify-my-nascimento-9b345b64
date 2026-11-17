import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Building2, ClipboardCheck, Crosshair, FolderTree, Layers, Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { analisarImpacto, modulosDoChamado, normalizarLista, rankingsDeTelas, type ChamadoImpacto, type ContagemImpacto } from "@/lib/chamados/impactoSistemico";
import { contarPorSetor, rotuloModulo } from "@/lib/chamados/arvoreModulos";
import { rotuloModuloLegado } from "../impactados";
import { useArvoreModulos } from "./catalogoTelas";
import { cn } from "@/lib/utils";

// =====================================================================
// IMPACTO SISTÊMICO — bloco do Monitoramento de Chamados (SIS-2026-0910).
//
// Responde o que a Controladoria pediu, sobre os chamados JÁ filtrados na
// tela: módulos com mais alterações (e quantas vezes cada um foi o módulo
// diretamente ajustado), setores mais impactados, abrangência (nº de módulos
// por chamado) e as áreas que vão precisar homologar (setores com chamados
// ainda não encerrados). Clicar num módulo/setor aplica o filtro de
// "impactado" da tela. As contas moram em lib/chamados/impactoSistemico.ts.
//
// SIS-2026-0921: os módulos agora são telas da barra lateral ("Controladoria ›
// Lucratividade de Contratos"); entra a coluna "Setores do ERP mais
// impactados" (cada chamado conta uma vez por setor do menu em que marcou
// tela) — clicar filtra o setor inteiro. Valores amplos de chamados antigos
// aparecem como o próprio setor, com o rótulo de antes. A coluna de telas
// troca de leitura, como o pedido lista: mais alterações, mais correções,
// mais impactadas por alterações em outras telas (reflexo) e as que mais
// geram integrações (mudança nela que reflete em outras) — rankingsDeTelas.
// =====================================================================

type VisaoTelas = "alteracoes" | "correcoes" | "reflexo" | "integracoes";
const VISOES_TELAS: { id: VisaoTelas; rotulo: string; dica: string }[] = [
  { id: "alteracoes", rotulo: "Alterações", dica: "Chamados que impactam a tela (em destaque: quantas vezes ela foi o módulo ajustado)" },
  { id: "correcoes", rotulo: "Correções", dica: "Chamados do tipo Correção ou da categoria Correção de Erro que impactam a tela" },
  { id: "reflexo", rotulo: "Reflexo", dica: "Vezes em que a tela foi impactada por uma alteração feita em outra tela" },
  { id: "integracoes", rotulo: "Integrações", dica: "Quando a tela é a ajustada: em quantas outras telas a mudança reflete (soma)" },
];

const LIMITE = 8;

function Barras({ titulo, icone: Icone, itens, rotulo, onClicar, ativo, mostrarPosicao, unidade = "chamado(s)", extra }: {
  titulo: string; icone: typeof Layers; itens: ContagemImpacto[]; rotulo: (v: string) => string;
  onClicar: (v: string) => void; ativo: string | null; mostrarPosicao?: boolean; unidade?: string; extra?: ReactNode;
}) {
  const max = Math.max(1, ...itens.map((i) => i.qtd));
  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Icone className="h-3.5 w-3.5 text-primary" /> {titulo}</p>
      {extra}
      {itens.length === 0 ? <p className="text-xs text-muted-foreground">Sem dados no filtro.</p> : (
        <div className="space-y-1">
          {itens.slice(0, LIMITE).map((i) => (
            <button
              key={i.valor} type="button" onClick={() => onClicar(i.valor)}
              title={`${rotulo(i.valor)}: ${i.qtd} ${unidade}${mostrarPosicao ? ` · ${i.comoPosicao} como módulo ajustado` : ""}. Clique para filtrar.`}
              className={cn("block w-full rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60", ativo === i.valor && "bg-primary/10 ring-1 ring-primary/40")}
            >
              <span className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-medium">{rotulo(i.valor)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {i.qtd}
                  {mostrarPosicao && i.comoPosicao > 0 && <span className="ml-1 text-primary" title="Como módulo diretamente ajustado">· {i.comoPosicao} <Crosshair className="inline h-3 w-3" /></span>}
                </span>
              </span>
              <span className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                {mostrarPosicao && <span className="h-full bg-primary" style={{ width: `${(i.comoPosicao / max) * 100}%` }} />}
                <span className="h-full bg-primary/40" style={{ width: `${((mostrarPosicao ? i.qtd - i.comoPosicao : i.qtd) / max) * 100}%` }} />
              </span>
            </button>
          ))}
          {itens.length > LIMITE && <p className="px-1.5 text-[10px] text-muted-foreground">+ {itens.length - LIMITE} com menos chamados</p>}
        </div>
      )}
    </div>
  );
}

export function ImpactoSistemicoPainel({ chamados, onFiltrarModulo, onFiltrarSetor, moduloAtivo, setorAtivo }: {
  chamados: readonly ChamadoImpacto[];
  onFiltrarModulo: (v: string) => void;
  onFiltrarSetor: (v: string) => void;
  moduloAtivo: string | null;
  setorAtivo: string | null;
}) {
  const a = useMemo(() => analisarImpacto(chamados), [chamados]);
  const { indice } = useArvoreModulos();
  // Índice do hook (organização salva aplicada), não o global.
  const rotuloModuloImpactado = useCallback((v: string) => rotuloModulo(v, indice, rotuloModuloLegado), [indice]);
  const porSetorErp = useMemo(() => {
    // Mesma base do analisarImpacto: chamado com setor informado e módulos com a
    // posição incluída (modulosDoChamado). "Outro" sem módulo não soma setor do ERP.
    const listas = chamados
      .filter((c) => normalizarLista(c.setores_impactados).length)
      .map((c) => modulosDoChamado(c))
      .filter((m) => m.length);
    const contagem = contarPorSetor(listas, indice, rotuloModuloLegado);
    return {
      itens: contagem.map((c): ContagemImpacto => ({ valor: c.valor, qtd: c.qtd, comoPosicao: 0, emAberto: 0 })),
      rotulos: new Map(contagem.map((c) => [c.valor, c.rotulo])),
    };
  }, [chamados, indice]);
  const maxFaixa = Math.max(1, ...a.faixas.map((f) => f.qtd));
  const [visaoTelas, setVisaoTelas] = useState<VisaoTelas>("alteracoes");
  const rankings = useMemo(() => rankingsDeTelas(chamados), [chamados]);
  const itensTelas: ContagemImpacto[] = visaoTelas === "alteracoes"
    ? a.modulos
    : rankings[visaoTelas].map((t) => ({ valor: t.valor, qtd: t.qtd, comoPosicao: 0, emAberto: 0 }));
  const visao = VISOES_TELAS.find((v) => v.id === visaoTelas)!;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold"><Network className="h-4 w-4 text-primary" /> Impacto sistêmico das solicitações</p>
        <p className="text-[11px] text-muted-foreground">
          {a.comImpacto} chamado(s) com impacto informado
          {a.semImpacto > 0 && <> · {a.semImpacto} sem (abertos antes do formulário de impacto)</>}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <Barras titulo="Setores do ERP mais impactados" icone={FolderTree} itens={porSetorErp.itens}
          rotulo={(v) => porSetorErp.rotulos.get(v) ?? rotuloModuloImpactado(v)}
          onClicar={onFiltrarModulo} ativo={moduloAtivo} />
        <Barras titulo={`Telas — ${visao.rotulo.toLowerCase()}`} icone={Layers} itens={itensTelas} rotulo={rotuloModuloImpactado}
          onClicar={onFiltrarModulo} ativo={moduloAtivo} mostrarPosicao={visaoTelas === "alteracoes"}
          unidade={visaoTelas === "integracoes" ? "tela(s) com reflexo" : "chamado(s)"}
          extra={(
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Leitura das telas">
              {VISOES_TELAS.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={visaoTelas === v.id} title={v.dica}
                  onClick={() => setVisaoTelas(v.id)}
                  className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    visaoTelas === v.id ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}>
                  {v.rotulo}
                </button>
              ))}
              <p className="w-full text-[10px] leading-tight text-muted-foreground">{visao.dica}.</p>
            </div>
          )} />
        <Barras titulo="Setores mais impactados" icone={Building2} itens={a.setores} rotulo={(v) => v}
          onClicar={onFiltrarSetor} ativo={setorAtivo} />

        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Network className="h-3.5 w-3.5 text-primary" /> Abrangência (módulos por chamado)</p>
          <div className="mb-2 flex gap-4">
            <div><p className="text-2xl font-bold leading-none">{a.abrangenciaMedia == null ? "—" : a.abrangenciaMedia.toFixed(1).replace(".", ",")}</p><p className="text-[10px] text-muted-foreground">média</p></div>
            <div><p className="text-2xl font-bold leading-none">{a.abrangenciaMaxima || "—"}</p><p className="text-[10px] text-muted-foreground">maior</p></div>
          </div>
          <div className="space-y-1">
            {a.faixas.map((f) => (
              <div key={f.faixa} className="text-[11px]">
                <span className="flex justify-between"><span>{f.faixa}</span><span className="tabular-nums text-muted-foreground">{f.qtd}</span></span>
                <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-info" style={{ width: `${(f.qtd / maxFaixa) * 100}%` }} /></span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Áreas para homologação</p>
          <p className="mb-2 text-[10px] text-muted-foreground">Setores impactados por chamados ainda não encerrados.</p>
          {a.homologacao.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma área com entrega pendente.</p> : (
            <div className="flex flex-wrap gap-1">
              {a.homologacao.map((s) => (
                <button key={s.valor} type="button" onClick={() => onFiltrarSetor(s.valor)}
                  className={cn("rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/20",
                    setorAtivo === s.valor && "ring-1 ring-warning")}
                  title={`${s.emAberto} chamado(s) em aberto impactam ${s.valor}`}>
                  {s.valor} <span className="tabular-nums">· {s.emAberto}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
