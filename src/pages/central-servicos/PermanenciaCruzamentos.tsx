import { useMemo } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  APROVACAO_ROTULO, IDENTIFICACAO, INTENCAO_ROTULO, INTENCOES, MIN_RESPOSTAS_GRUPO, NAO_INFORMADO,
  cruzar, cruzarDuplo, filtrar, impactoLideranca, rotuloPerfil,
  type Aprovacao, type CampoPerfil, type Celula, type Filtro, type Intencao, type LinhaResposta,
} from "../../../supabase/functions/_shared/pesquisa-permanencia";

// =====================================================================
// FORMULÁRIOS › PESQUISA DE PERMANÊNCIA › CRUZAMENTOS (SIS-2026-0756)
// (/app/central-servicos/formularios/:id/analise?aba=cruzamentos)
//
// Helena (RH), 09/11/2026: "4 visões de cruzamentos obrigatórios, onde
// qualquer filtro limpa e atualiza os demais automaticamente".
//   C1 Região × Intenção × Motivo   C2 Área × Intenção × Motivo
//   C3 Gênero × Faixa etária × Intenção × Motivo
//   C4 Aprovação da gestão × Intenção × (Região + Área)
// O filtro é UM só para a tela inteira (o mesmo do card de cima, que vai
// também para a I.A). Cada visão é calculada com todos os filtros MENOS o da
// própria dimensão — clicar numa região destaca a região no C1 e recorta
// C2, C3 e C4; clicar de novo solta.
// Anonimato: célula com menos de MIN_RESPOSTAS_GRUPO respostas mostra só a
// quantidade (gênero + faixa + região juntos identificariam alguém).
// Contas e regras (de que pergunta sai a intenção etc.) no _shared, com teste.
// =====================================================================

const fmtPct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const COR: Record<Intencao, string> = { fica: "bg-emerald-500", duvida: "bg-amber-400", sai: "bg-red-500" };

type SetFiltro = (f: Filtro) => void;
const sem = (f: Filtro, ...ks: (keyof Filtro)[]): Filtro => { const o: Record<string, unknown> = { ...f }; for (const k of ks) o[k] = null; return o as Filtro; };
const alterna = (f: Filtro, k: keyof Filtro, v: string, set: SetFiltro) => set({ ...f, [k]: f[k] === v ? null : v });

export function Cruzamentos({ todas, filtro, setFiltro }: { todas: LinhaResposta[]; filtro: Filtro; setFiltro: SetFiltro }) {
  const recorte = useMemo(() => filtrar(todas, filtro), [todas, filtro]);
  const semPerfil = todas.length > 0 && todas.every((l) => !l.perfil || !Object.keys(l.perfil).length);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
        <span className="text-xs text-muted-foreground">Intenção de permanência:</span>
        {INTENCOES.map((i) => (
          <Button key={i} size="sm" variant={filtro.intencao === i ? "default" : "outline"} className="h-7"
            onClick={() => alterna(filtro, "intencao", i, setFiltro)}>
            <span className={cn("mr-1.5 inline-block h-2.5 w-2.5 rounded-full", COR[i])} />{INTENCAO_ROTULO[i]}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{recorte.length.toLocaleString("pt-BR")} respostas no recorte</span>
        <FiltrosAtivos filtro={filtro} setFiltro={setFiltro} />
      </Card>

      {semPerfil && (
        <Card className="p-3 text-xs text-muted-foreground">
          As respostas que existem são de antes das perguntas de região, área, gênero e faixa etária. Elas aparecem como “Não informado”;
          os cruzamentos se preenchem com as próximas respostas.
        </Card>
      )}
      {recorte.length > 0 && recorte.length < MIN_RESPOSTAS_GRUPO && (
        <Card className="flex items-center gap-2 p-3 text-sm text-amber-700">
          <ShieldAlert className="h-4 w-4" />Menos de {MIN_RESPOSTAS_GRUPO} respostas neste recorte: os detalhes ficam ocultos para não identificar ninguém.
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <MapaRegioes todas={todas} filtro={filtro} setFiltro={setFiltro} />
        <MatrizArea todas={todas} filtro={filtro} setFiltro={setFiltro} />
      </div>
      <RaioXDemografico todas={todas} filtro={filtro} setFiltro={setFiltro} />
      <ImpactoLideranca todas={todas} filtro={filtro} setFiltro={setFiltro} />
      <p className="text-[11px] text-muted-foreground">
        Intenção de permanência = pergunta “Você indicaria o Grupo Nascimento para um amigo trabalhar?” (Sim, com certeza = pretende ficar;
        Sim, mas há pontos a melhorar = em dúvida; Não indicaria = risco de sair). Aprovação da gestão = relacionamento com o encarregado
        (Muito bom/Bom = aprova; Regular = neutro; Ruim = desaprova). Motivo de saída = a situação marcada como a mais importante na pergunta
        “Quais situações poderiam levar você a pedir demissão?”.
      </p>
    </div>
  );
}

function FiltrosAtivos({ filtro, setFiltro }: { filtro: Filtro; setFiltro: SetFiltro }) {
  const chips: { k: keyof Filtro; rotulo: string }[] = [];
  for (const c of ["regiao", "area", "genero", "faixa"] as CampoPerfil[]) if (filtro[c]) chips.push({ k: c, rotulo: rotuloPerfil(c, filtro[c]) });
  if (filtro.aprovacao) chips.push({ k: "aprovacao", rotulo: `Gestão: ${APROVACAO_ROTULO[filtro.aprovacao]}` });
  if (!chips.length) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Badge key={c.k} variant="secondary" className="cursor-pointer gap-1" onClick={() => setFiltro({ ...filtro, [c.k]: null })}>
          {c.rotulo}<X className="h-3 w-3" />
        </Badge>
      ))}
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
        onClick={() => setFiltro(sem(filtro, "regiao", "area", "genero", "faixa", "aprovacao", "intencao"))}>Limpar cruzamentos</Button>
    </div>
  );
}

/** Barra empilhada pretende ficar / em dúvida / risco de sair. */
function Barra({ c }: { c: Celula }) {
  if (c.reservado) return <div className="h-3 rounded bg-muted" title={`Menos de ${MIN_RESPOSTAS_GRUPO} respostas: não detalhado`} />;
  return (
    <div className="flex h-3 overflow-hidden rounded bg-muted" title={INTENCOES.map((i) => `${INTENCAO_ROTULO[i]}: ${fmtPct(c.pct[i])}`).join(" · ")}>
      {INTENCOES.map((i) => <div key={i} className={COR[i]} style={{ width: `${c.pct[i]}%` }} />)}
    </div>
  );
}

const Motivo = ({ c }: { c: Celula }) => c.reservado
  ? <span className="text-muted-foreground">—</span>
  : c.motivo ? <span>{c.motivo.rotulo} <span className="text-muted-foreground">({c.motivo.n})</span></span> : <span className="text-muted-foreground">—</span>;

// ─── C1 ───────────────────────────────────────────────────────────────────
function MapaRegioes({ todas, filtro, setFiltro }: { todas: LinhaResposta[]; filtro: Filtro; setFiltro: SetFiltro }) {
  const cel = useMemo(() => cruzar(filtrar(todas, sem(filtro, "regiao")), "regiao"), [todas, filtro]);
  const sel = cel.find((c) => c.chave === filtro.regiao);
  return (
    <Card className="p-4">
      <h3 className="font-semibold">1. Mapa geográfico da retenção e riscos</h3>
      <p className="mb-3 text-xs text-muted-foreground">Região × intenção de permanência × motivo de saída. Clique numa região para ver o detalhe e recortar as outras visões.</p>
      <div className="space-y-1.5">
        {cel.map((c) => (
          <button key={c.chave} type="button" onClick={() => alterna(filtro, "regiao", c.chave, setFiltro)}
            className={cn("block w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50",
              filtro.regiao === c.chave && "border-primary bg-primary/5", c.n === 0 && "opacity-60")}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-medium">{c.rotulo}</span>
              <span className="shrink-0 text-muted-foreground">{c.n} resp.{!c.reservado && ` · ${fmtPct(c.pct.sai)} risco de sair`}</span>
            </div>
            <Barra c={c} />
          </button>
        ))}
      </div>
      {sel && <Detalhe c={sel} titulo={sel.rotulo} />}
    </Card>
  );
}

function Detalhe({ c, titulo }: { c: Celula; titulo: string }) {
  return (
    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
      <p className="mb-1 text-sm font-semibold">{titulo}</p>
      {c.reservado ? (
        <p className="text-muted-foreground">{c.n} resposta(s) — menos de {MIN_RESPOSTAS_GRUPO}, não detalhado (anonimato).</p>
      ) : (<>
        <p>Lealdade: <b>{fmtPct(c.pct.fica)}</b> pretendem ficar · {fmtPct(c.pct.duvida)} em dúvida · <b className="text-red-600">{fmtPct(c.pct.sai)}</b> risco de sair · {c.desaprova} desaprovam a gestão</p>
        <p className="mt-1.5 font-medium text-muted-foreground">Principais motivos de saída (o mais importante de cada um)</p>
        {c.motivos.slice(0, 4).map((m) => <p key={m.cod}>{m.rotulo}: <b>{m.n}</b> ({fmtPct(m.pct)})</p>)}
        {!c.motivos.length && <p className="text-muted-foreground">Nenhum motivo informado.</p>}
      </>)}
    </div>
  );
}

// ─── C2 ───────────────────────────────────────────────────────────────────
function MatrizArea({ todas, filtro, setFiltro }: { todas: LinhaResposta[]; filtro: Filtro; setFiltro: SetFiltro }) {
  const cel = useMemo(() => cruzar(filtrar(todas, sem(filtro, "area")), "area"), [todas, filtro]);
  const exemplos = new Map(IDENTIFICACAO.find((p) => p.campo === "area")!.opcoes.map((o) => [o.cod, o.descricao]));
  return (
    <Card className="p-4">
      <h3 className="font-semibold">2. Matriz funcional de alerta</h3>
      <p className="mb-3 text-xs text-muted-foreground">Área × intenção de permanência × motivo de saída. Clique numa linha para recortar.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-2">Área</th><th className="px-2 text-right">Resp.</th>
            {INTENCOES.map((i) => <th key={i} className="px-2 text-right">{INTENCAO_ROTULO[i]}</th>)}
            <th className="px-2">Motivo de saída principal</th>
          </tr></thead>
          <tbody>
            {cel.map((c) => (
              <tr key={c.chave} onClick={() => alterna(filtro, "area", c.chave, setFiltro)} title={exemplos.get(c.chave) ?? ""}
                className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50", filtro.area === c.chave && "bg-primary/5", c.n === 0 && "opacity-60")}>
                <td className="py-1.5 pr-2 font-medium">{c.rotulo}</td>
                <td className="px-2 text-right">{c.n}</td>
                {INTENCOES.map((i) => (
                  <td key={i} className={cn("px-2 text-right", i === "sai" && !c.reservado && c.pct.sai >= 30 && "font-semibold text-red-600")}>
                    {c.reservado ? "—" : fmtPct(c.pct[i])}
                  </td>
                ))}
                <td className="px-2"><Motivo c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── C3 ───────────────────────────────────────────────────────────────────
function RaioXDemografico({ todas, filtro, setFiltro }: { todas: LinhaResposta[]; filtro: Filtro; setFiltro: SetFiltro }) {
  const m = useMemo(() => cruzarDuplo(filtrar(todas, sem(filtro, "genero", "faixa")), "genero", "faixa"), [todas, filtro]);
  const marcado = (g: string | null, f: string | null) => (filtro.genero ?? null) === g && (filtro.faixa ?? null) === f;
  const escolhe = (g: string | null, f: string | null) =>
    setFiltro(marcado(g, f) ? sem(filtro, "genero", "faixa") : { ...filtro, genero: g, faixa: f });
  return (
    <Card className="p-4">
      <h3 className="font-semibold">3. Raio-X demográfico e geracional</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Gênero × faixa etária × intenção × motivo. Clique num quadro (ou no nome da linha/coluna) para combinar os filtros livremente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-2" />
            {m.colunas.map((c) => (
              <th key={c.chave} className="px-1">
                <button type="button" className={cn("rounded px-1.5 py-0.5 hover:bg-muted", marcado(null, c.chave) && "bg-primary/10 text-foreground")}
                  onClick={() => escolhe(null, c.chave)}>{c.rotulo}</button>
              </th>
            ))}
            <th className="px-1">Total</th>
          </tr></thead>
          <tbody>
            {m.linhas.filter((l) => l.chave !== NAO_INFORMADO || l.total.n > 0).map((l) => (
              <tr key={l.chave}>
                <td className="py-1 pr-2">
                  <button type="button" className={cn("rounded px-1.5 py-0.5 font-medium hover:bg-muted", marcado(l.chave, null) && "bg-primary/10")}
                    onClick={() => escolhe(l.chave, null)}>{l.rotulo}</button>
                </td>
                {l.celulas.map((c) => (
                  <td key={c.chave} className="p-1 align-top">
                    <Quadro c={c} ativo={marcado(l.chave, c.chave)} onClick={() => escolhe(l.chave, c.chave)} />
                  </td>
                ))}
                <td className="p-1 align-top"><Quadro c={l.total} ativo={false} onClick={() => escolhe(l.chave, null)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Quadro({ c, ativo, onClick }: { c: Celula; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("block w-full min-w-[150px] rounded-md border p-2 text-left hover:bg-muted/50", ativo && "border-primary bg-primary/5", c.n === 0 && "opacity-50")}>
      <div className="mb-1 flex justify-between"><span className="text-muted-foreground">{c.n} resp.</span>
        {!c.reservado && <span className={cn(c.pct.sai >= 30 && "font-semibold text-red-600")}>{fmtPct(c.pct.sai)} sair</span>}</div>
      <Barra c={c} />
      <p className="mt-1 truncate text-[11px]" title={c.motivo?.rotulo}><Motivo c={c} /></p>
    </button>
  );
}

// ─── C4 ───────────────────────────────────────────────────────────────────
function ImpactoLideranca({ todas, filtro, setFiltro }: { todas: LinhaResposta[]; filtro: Filtro; setFiltro: SetFiltro }) {
  const lid = useMemo(() => impactoLideranca(filtrar(todas, sem(filtro, "aprovacao"))), [todas, filtro]);
  const isolado = filtro.aprovacao === "desaprova";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">4. Impacto da liderança</h3>
          <p className="text-xs text-muted-foreground">Aprovação da gestão × intenção de permanência × (região + área).</p>
        </div>
        <Button size="sm" variant={isolado ? "default" : "outline"} onClick={() => alterna(filtro, "aprovacao", "desaprova", setFiltro)}>
          {isolado ? "Mostrando só quem desaprova" : "Isolar quem desaprova"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {lid.porAprovacao.map((c) => (
          <button key={c.chave} type="button" onClick={() => alterna(filtro, "aprovacao", c.chave as Aprovacao, setFiltro)}
            className={cn("rounded-lg border p-3 text-left text-xs hover:bg-muted/50", filtro.aprovacao === c.chave && "border-primary bg-primary/5")}>
            <div className="mb-1 flex justify-between"><span className="text-sm font-medium">{c.rotulo}</span><span className="text-muted-foreground">{c.n} resp.</span></div>
            <Barra c={c} />
            <p className="mt-1">{c.reservado ? "—" : <>Risco de sair: <b>{fmtPct(c.pct.sai)}</b></>}</p>
          </button>
        ))}
      </div>
      {lid.diferencaSai !== null && (
        <p className={cn("mt-2 text-sm", lid.diferencaSai >= 20 ? "text-red-600" : "text-muted-foreground")}>
          Quem desaprova a gestão tem {lid.diferencaSai >= 0 ? `${fmtPct(lid.diferencaSai).replace("%", "")} pontos a mais` : `${fmtPct(-lid.diferencaSai).replace("%", "")} pontos a menos`} de
          risco de sair do que quem aprova.{lid.diferencaSai >= 20 && " A saída está ligada à liderança local, não só à empresa."}
        </p>
      )}

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <TabelaDesaprova titulo="Quem desaprova, por região" cel={lid.porRegiao} onClick={(k) => alterna(filtro, "regiao", k, setFiltro)} ativo={filtro.regiao} />
        <TabelaDesaprova titulo="Quem desaprova, por área" cel={lid.porArea} onClick={(k) => alterna(filtro, "area", k, setFiltro)} ativo={filtro.area} />
      </div>
    </Card>
  );
}

function TabelaDesaprova({ titulo, cel, onClick, ativo }: { titulo: string; cel: Celula[]; onClick: (k: string) => void; ativo?: string | null }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium">{titulo}</p>
      {!cel.length ? <p className="text-xs text-muted-foreground">Ninguém desaprova neste recorte.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2" /><th className="px-2 text-right">Desaprovam</th><th className="px-2 text-right">Risco de sair</th><th className="px-2">Motivo</th>
          </tr></thead>
          <tbody>
            {cel.map((c) => (
              <tr key={c.chave} onClick={() => onClick(c.chave)} className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50", ativo === c.chave && "bg-primary/5")}>
                <td className="py-1 pr-2 font-medium">{c.rotulo}</td>
                <td className="px-2 text-right">{c.n}</td>
                <td className="px-2 text-right">{c.reservado ? "—" : fmtPct(c.pct.sai)}</td>
                <td className="px-2"><Motivo c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
