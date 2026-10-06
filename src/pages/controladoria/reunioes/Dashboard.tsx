import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, ChevronRight, ClipboardCheck, MessageSquareWarning, Target, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCtrlAcoes, useCtrlRegistros, useCtrlReunioes } from "@/hooks/useReunioesEncarregados";
import { ROTULO_TIPO, contarPor, normalizar, temasRecorrentes } from "@/lib/controladoria/reunioes";
import { SeloTipo, dataBR, semCodigo } from "./comum";

// =====================================================================
// Reuniões com Encarregados › Dashboard (mig 20261006000005).
// Mesma leitura do protótipo: reuniões na seleção, nomes identificados,
// registros para atenção, revisão; temas mais recorrentes (em quantas
// REUNIÕES o tema apareceu — não soma 100%), reuniões no período,
// composição por tipo, casos para acompanhamento, e o que o ERP soma:
// ranking por contrato e por encarregado, e o plano de ação.
// Excluídos na revisão nunca contam; "só validados" é opcional.
// =====================================================================

const TODOS = "__todos";
const AZUL = "#2a2fa8", LARANJA = "#f97316";
const BARRAS = ["#f97316", "#2a2fa8", "#3b4fd8", "#6b7fe6", "#94a3c8", "#a5b4fc", "#7c8db5", "#a5b4fc", "#c7d2fe", "#cbd5e1"];

export default function Dashboard({ irPara }: { irPara: (aba: string, extra?: Record<string, string>) => void }) {
  const { data: reunioes = [] } = useCtrlReunioes();
  const { data: registros = [] } = useCtrlRegistros();
  const { data: acoes = [] } = useCtrlAcoes();
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [supervisor, setSupervisor] = useState(TODOS);
  const [equipe, setEquipe] = useState(TODOS);
  const [contrato, setContrato] = useState(TODOS);
  const [soValidados, setSoValidados] = useState("todos");

  const opcoes = useMemo(() => ({
    supervisores: [...new Set(reunioes.map((r) => r.supervisor).filter(Boolean) as string[])].sort(),
    equipes: [...new Set(reunioes.map((r) => r.equipe).filter(Boolean) as string[])].sort(),
    contratos: [...new Set(registros.map((r) => r.contrato).filter(Boolean) as string[])].sort(),
  }), [reunioes, registros]);

  const sel = useMemo(() => {
    const reus = reunioes.filter((r) => (!de || (r.data_reuniao ?? "") >= de) && (!ate || (r.data_reuniao ?? "9999") <= ate)
      && (supervisor === TODOS || r.supervisor === supervisor) && (equipe === TODOS || r.equipe === equipe));
    const ids = new Set(reus.map((r) => r.id));
    const todos = registros.filter((r) => ids.has(r.reuniao_id) && (contrato === TODOS || r.contrato === contrato));
    const ativos = todos.filter((r) => r.status !== "excluido" && (soValidados === "todos" || r.status === "validado"));
    // Com contrato filtrado, "reuniões" = as que tiveram registro desse contrato.
    const reusFinais = contrato === TODOS ? reus : reus.filter((r) => todos.some((x) => x.reuniao_id === r.id));
    return { reus: reusFinais, todos, ativos };
  }, [reunioes, registros, de, ate, supervisor, equipe, contrato, soValidados]);

  const nomes = useMemo(() => {
    const s = new Set<string>();
    sel.reus.forEach((r) => r.participantes.forEach((p) => s.add(normalizar(p))));
    sel.ativos.forEach((r) => (r.encarregado || r.falante) && s.add(normalizar((r.encarregado || r.falante)!)));
    return s.size;
  }, [sel]);
  const revisados = sel.todos.filter((r) => r.status !== "pendente").length;
  const temas = temasRecorrentes(sel.ativos, sel.reus.length);
  const porData = useMemo(() => {
    const m = new Map<string, number>();
    sel.reus.forEach((r) => r.data_reuniao && m.set(r.data_reuniao, (m.get(r.data_reuniao) ?? 0) + 1));
    return [...m.entries()].sort().map(([d, n]) => ({ d, rotulo: dataBR(d).slice(0, 5), n }));
  }, [sel.reus]);
  const dif = sel.ativos.filter((r) => r.tipo === "dificuldade").length, duv = sel.ativos.length - dif;
  const porContrato = contarPor(sel.ativos, (r) => semCodigo(r.contrato)).slice(0, 10);
  const porEncarregado = contarPor(sel.ativos, (r) => r.encarregado || r.falante).slice(0, 10);
  const reuPorId = new Map(reunioes.map((r) => [r.id, r]));
  const casos = [...sel.ativos].filter((r) => r.tipo === "dificuldade")
    .sort((a, b) => (reuPorId.get(b.reuniao_id)?.data_reuniao ?? "").localeCompare(reuPorId.get(a.reuniao_id)?.data_reuniao ?? "")).slice(0, 6);
  const hoje = new Date().toISOString().slice(0, 10);
  const acoesAbertas = acoes.filter((a) => a.situacao !== "concluida");
  const atrasadas = acoesAbertas.filter((a) => a.prazo && a.prazo < hoje).length;

  if (!reunioes.length) {
    return (
      <Card className="grid place-items-center gap-2 p-10 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">Nenhuma reunião importada ainda</p>
        <button className="text-sm font-medium text-primary hover:underline" onClick={() => irPara("importar")}>Importar as primeiras transcrições →</button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input type="date" className="h-9 w-36" value={de} onChange={(e) => setDe(e.target.value)} /> até
          <Input type="date" className="h-9 w-36" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <Filtro valor={supervisor} onChange={setSupervisor} opcoes={opcoes.supervisores} todos="Todos os supervisores" />
        <Filtro valor={equipe} onChange={setEquipe} opcoes={opcoes.equipes} todos="Todas as equipes" />
        <Filtro valor={contrato} onChange={setContrato} opcoes={opcoes.contratos} todos="Todos os contratos" rotulo={semCodigo} />
        <Select value={soValidados} onValueChange={setSoValidados}>
          <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Validados + a revisar</SelectItem><SelectItem value="validados">Só validados</SelectItem></SelectContent>
        </Select>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icone={CalendarDays} rotulo="Reuniões na seleção" valor={sel.reus.length} dica={`${sel.reus.filter((r) => r.data_reuniao).length} com data identificada`} />
        <Kpi icone={Users} rotulo="Nomes identificados" valor={nomes} dica="Participantes únicos; não é uma lista de presença auditada." cor="text-orange-500" />
        <Kpi icone={MessageSquareWarning} rotulo="Registros para atenção" valor={sel.ativos.length} dica="Dificuldades/reclamações + dúvidas/solicitações." />
        <Kpi icone={ClipboardCheck} rotulo="Revisão do levantamento" valor={revisados} sufixo={` / ${sel.todos.length}`} dica="Validados ou excluídos na revisão." cor="text-emerald-600"
          onClick={() => irPara("revisar", { status: "pendente" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="font-bold">Temas mais recorrentes</p><p className="text-xs text-muted-foreground">Reuniões com registros em cada tema</p></div>
            <Badge variant="outline" className="text-[10px]">{soValidados === "todos" ? "PRÉVIA" : "VALIDADO"}</Badge>
          </div>
          <div className="mt-4 space-y-2.5">
            {temas.length === 0 && <p className="text-xs text-muted-foreground">Sem registros na seleção.</p>}
            {temas.map((t, i) => (
              <button key={t.tema} type="button" onClick={() => irPara("revisar", { tema: t.tema, status: soValidados === "todos" ? "__todos" : "validado" })}
                className="grid w-full grid-cols-[minmax(0,10rem)_1fr_2rem_3.5rem] items-center gap-3 text-left text-xs hover:opacity-80">
                <span className="truncate">{t.tema}</span>
                <div className="h-2.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${t.pct}%`, background: BARRAS[i % BARRAS.length] }} /></div>
                <b className="text-right tabular-nums">{t.reunioes}</b>
                <span className="text-right tabular-nums text-muted-foreground">{t.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Uma marcação por tema em cada reunião. Os percentuais usam {sel.reus.length} reunião(ões) e não somam 100%.</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div><p className="font-bold">Reuniões no período</p><p className="text-xs text-muted-foreground">Distribuição das reuniões por data</p></div>
            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-[10px] text-orange-700">{sel.reus.length} reunião(ões)</Badge>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={porData} margin={{ top: 24, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={[0, (max: number) => max + 1]} />
              <Tooltip formatter={(v: number) => [`${v} reunião(ões)`, ""]} />
              <Area type="linear" dataKey="n" stroke={LARANJA} strokeWidth={2.5} fill={LARANJA} fillOpacity={0.1} dot={{ r: 4, fill: LARANJA }}>
                <LabelList dataKey="n" position="top" fontSize={11} fontWeight={700} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground">Volume de reuniões importadas; não mede melhora ou piora dos contratos.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_1fr]">
        <Card className="p-5">
          <p className="font-bold">Composição do levantamento</p>
          <p className="text-xs text-muted-foreground">Tipos de registro na seleção</p>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[{ v: dif }, { v: duv }]} dataKey="v" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                    <Cell fill={AZUL} /><Cell fill={LARANJA} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div><p className="text-2xl font-black tabular-nums">{sel.ativos.length}</p><p className="text-[10px] text-muted-foreground">registros</p></div>
              </div>
            </div>
            <div className="space-y-3 text-xs">
              {([["dificuldade", dif, AZUL], ["duvida", duv, LARANJA]] as const).map(([k, n, cor]) => (
                <div key={k}>
                  <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: cor }} />{ROTULO_TIPO[k]} <b className="ml-2 tabular-nums">{n}</b></div>
                  <p className="pl-3.5 text-muted-foreground">{sel.ativos.length ? ((n * 100) / sel.ativos.length).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : 0}% do recorte</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Cada registro tem um único tipo. O total não representa pessoas, falas nem problemas únicos.</p>
        </Card>

        <Card className="p-5">
          <p className="font-bold">Casos para acompanhamento</p>
          <p className="text-xs text-muted-foreground">Dificuldades mais recentes · veja a evidência completa na revisão</p>
          <div className="mt-3 divide-y">
            {casos.length === 0 && <p className="py-4 text-xs text-muted-foreground">Nenhuma dificuldade na seleção.</p>}
            {casos.map((r) => (
              <div key={r.id} className="grid grid-cols-[8rem_1fr] gap-3 py-2 text-xs">
                <div>
                  <p className="font-semibold">{semCodigo(r.contrato) || "Contrato a confirmar"}</p>
                  <p className="text-muted-foreground">{dataBR(reuPorId.get(r.reuniao_id)?.data_reuniao)}</p>
                  <p className="truncate text-muted-foreground">{r.encarregado ?? r.falante}</p>
                </div>
                <div><p className="font-semibold text-primary">{r.tema}</p><p className="line-clamp-2 text-muted-foreground">{r.trecho}</p></div>
              </div>
            ))}
          </div>
          <button className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => irPara("revisar", { status: "__todos" })}>Ver todos os registros <ChevronRight className="h-3.5 w-3.5" /></button>
        </Card>

        <Card className="space-y-4 p-5">
          <div><p className="font-bold">Leitura do painel</p><p className="text-xs text-muted-foreground">Indicadores calculados sobre a seleção</p></div>
          <Leitura icone={BarChart3} titulo={temas[0]?.tema ?? "Sem tema dominante"} texto={temas[0] ? `${temas[0].reunioes} de ${sel.reus.length} reuniões têm registros deste tema.` : "Importe ou amplie a seleção."} />
          <Leitura icone={ClipboardCheck} titulo={`${sel.todos.length - revisados} registro(s) a revisar`} texto="Sugestões das regras ainda não conferidas por ninguém." onClick={() => irPara("revisar", { status: "pendente" })} />
          <Leitura icone={Target} titulo={`${acoesAbertas.length} ação(ões) em aberto`} texto={atrasadas ? `${atrasadas} com prazo vencido.` : "Responsável, prazo e situação vêm de quem cria — nada é presumido."} onClick={() => irPara("acoes")} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Ranking titulo="Registros por contrato" itens={porContrato} cor={AZUL} />
        <Ranking titulo="Registros por encarregado" itens={porEncarregado} cor={LARANJA} />
      </div>
    </div>
  );
}

function Filtro({ valor, onChange, opcoes, todos, rotulo = (s) => s }: { valor: string; onChange: (v: string) => void; opcoes: string[]; todos: string; rotulo?: (s: string) => string }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value={TODOS}>{todos}</SelectItem>{opcoes.map((o) => <SelectItem key={o} value={o}>{rotulo(o)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Kpi({ icone: I, rotulo, valor, sufixo, dica, cor = "text-primary", onClick }: {
  icone: typeof Users; rotulo: string; valor: number; sufixo?: string; dica: string; cor?: string; onClick?: () => void;
}) {
  return (
    <Card className={`p-4 ${onClick ? "cursor-pointer hover:border-primary/40" : ""}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="grid h-8 w-8 place-items-center rounded-full bg-muted"><I className={`h-4 w-4 ${cor}`} /></span>{rotulo}</div>
      <p className="mt-2 text-3xl font-black tabular-nums">{valor.toLocaleString("pt-BR")}{sufixo && <span className="text-base font-semibold text-muted-foreground">{sufixo}</span>}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{dica}</p>
    </Card>
  );
}

function Leitura({ icone: I, titulo, texto, onClick }: { icone: typeof Users; titulo: string; texto: string; onClick?: () => void }) {
  return (
    <div className={`flex gap-3 ${onClick ? "cursor-pointer hover:opacity-80" : ""}`} onClick={onClick}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10"><I className="h-4 w-4 text-primary" /></span>
      <div><p className="text-sm font-semibold">{titulo}</p><p className="text-xs text-muted-foreground">{texto}</p></div>
    </div>
  );
}

function Ranking({ titulo, itens, cor }: { titulo: string; itens: { nome: string; n: number }[]; cor: string }) {
  const max = Math.max(...itens.map((i) => i.n), 1);
  return (
    <Card className="p-5">
      <p className="mb-3 font-bold">{titulo}</p>
      {itens.length === 0 ? <p className="text-xs text-muted-foreground">Sem registros na seleção.</p> : (
        <div className="space-y-2">
          {itens.map((i) => (
            <div key={i.nome} className="text-xs">
              <div className="flex justify-between gap-2"><span className="truncate">{i.nome}</span><b className="tabular-nums">{i.n}</b></div>
              <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(i.n / max) * 100}%`, background: cor }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
