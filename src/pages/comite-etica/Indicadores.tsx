import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db } from "./db";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import {
  Inbox, TimerOff, Clock, Gavel, ShieldCheck, Repeat, GraduationCap,
  ListChecks, TrendingUp, HelpCircle, FileWarning, Building2, Users,
} from "lucide-react";
import {
  LABEL_TIPO, LABEL_GRAVIDADE, LABEL_CAUSA, LABEL_MEDIDA, LABEL_ORIGEM,
  LABEL_RESULTADO, LABEL_SITUACAO, COR_GRAVIDADE, COR_RESULTADO, CORES,
  MEDIDA, rotulo,
} from "./vocabulario";
import {
  type Denuncia, type RegraSla, concluida, contarPor, diasAtePrimeiraProvidencia,
  diasDeTratamento, diasRestantes, dentroDoSla, causaSistemica, fmtDias, fmtPct,
  gerouTreinamento, media, pct, procedente, reincidencias, serieMensal,
  temMedidaDisciplinar, tipoEfetivo, vencida,
} from "./metricas";

// =====================================================================
// COMITÊ DE ÉTICA — INDICADORES
//
// O painel existe para responder pergunta de gestão, não para exibir
// gráfico: cada bloco aqui sai direto da lista que a diretoria pediu, e o
// último bloco responde, com número, as cinco perguntas estratégicas.
//
// Tudo é derivado na leitura (ver metricas.ts) a partir de uma leitura só
// da CANAL_DENUNCIA + a régua de SLA. Volume de comitê é baixo por
// natureza; agregar no banco aqui só adicionaria RPC para manter.
//
// REGRA DA TELA: indicador sem base não inventa número. Onde não há caso
// suficiente aparece "—" e, quando faz diferença, quantos casos estão sem
// o campo preenchido — indicador que esconde buraco de cadastro é pior do
// que indicador nenhum.
// =====================================================================

const TIP: React.CSSProperties = {
  maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word", fontSize: 12,
  lineHeight: 1.35, borderRadius: 8, border: "1px solid #e2e8f0",
  boxShadow: "0 8px 24px rgba(15,23,42,.12)",
};

const fmtData = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("pt-BR", { dateStyle: "short" }) : "—";

export default function IndicadoresComiteEtica() {
  const nav = useNavigate();
  const [meses, setMeses] = useState("12");
  const [fContrato, setFContrato] = useState("todos");
  const [fSetor, setFSetor] = useState("todos");

  const { data: todas = [], isLoading } = useQuery({
    queryKey: ["canal-denuncias"],
    queryFn: async () => {
      const { data, error } = await db
        .from("CANAL_DENUNCIA").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Denuncia[];
    },
  });

  const { data: slas = [] } = useQuery({
    queryKey: ["comite-etica-sla"],
    queryFn: async () => {
      const { data, error } = await db.from("COMITE_ETICA_SLA").select("*");
      if (error) throw error;
      return (data ?? []) as RegraSla[];
    },
  });

  const contratos = useMemo(
    () => [...new Set(todas.map((d) => (d.contrato ?? "").trim()).filter(Boolean))].sort(),
    [todas]);
  const setores = useMemo(
    () => [...new Set(todas.map((d) => (d.setor ?? "").trim()).filter(Boolean))].sort(),
    [todas]);

  /** Recorte que vale para o painel inteiro. */
  const ds = useMemo(() => {
    const corte = meses === "tudo" ? null
      : new Date(new Date().setMonth(new Date().getMonth() - Number(meses)));
    return todas.filter((d) => {
      if (corte && new Date(d.created_at) < corte) return false;
      if (fContrato !== "todos" && (d.contrato ?? "").trim() !== fContrato) return false;
      if (fSetor !== "todos" && (d.setor ?? "").trim() !== fSetor) return false;
      return true;
    });
  }, [todas, meses, fContrato, fSetor]);

  const m = useMemo(() => {
    const concluidas = ds.filter(concluida);
    const abertas = ds.filter((d) => !concluida(d));
    const comResultado = ds.filter((d) => !!d.resultado);
    const noSla = concluidas.map((d) => dentroDoSla(d, slas)).filter((x): x is boolean => x !== null);
    const primeiras = ds.map(diasAtePrimeiraProvidencia).filter((x): x is number => x !== null);

    const reincColab = reincidencias(ds, (d) => (d.denunciado_empregado_id ? `#${d.denunciado_empregado_id}` : ""), (d) => d.denunciado_nome ?? "—");
    const reincLider = reincidencias(ds, (d) => (d.lider_empregado_id ? `#${d.lider_empregado_id}` : (d.lider_nome ?? "").trim()), (d) => d.lider_nome ?? "—");
    const reincContrato = reincidencias(ds, (d) => (d.contrato ?? "").trim(), (d) => d.contrato ?? "—");

    // "Voltou a acontecer depois da medida": soma dos casos que entraram após
    // a conclusão de um caso anterior, da mesma pessoa, que aplicou medida.
    const recaidas = reincColab.reduce((s, r) => s + r.aposMedida, 0);
    const comMedidaDisc = ds.filter(temMedidaDisciplinar);

    const medidasContagem = MEDIDA.map((op) => ({
      chave: op.value, label: op.label,
      total: ds.filter((d) => (d.medidas ?? []).includes(op.value)).length,
    })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);

    return {
      total: ds.length,
      abertas: abertas.length,
      vencidas: abertas.filter((d) => vencida(d, slas)).length,
      concluidas: concluidas.length,
      tempoMedio: media(concluidas.map((d) => diasDeTratamento(d))),
      pctSla: pct(noSla.filter(Boolean).length, noSla.length),
      semSla: concluidas.length - noSla.length,
      pctProcedente: pct(comResultado.filter(procedente).length, comResultado.length),
      pctImprocedente: pct(comResultado.filter((d) => d.resultado === "improcedente").length, comResultado.length),
      semResultado: ds.length - comResultado.length,
      tempoPrimeira: media(primeiras),
      semPrimeira: ds.length - primeiras.length,
      disciplinares: comMedidaDisc.length,
      treinamentos: ds.filter(gerouTreinamento).length,
      sistemicas: pct(ds.filter(causaSistemica).length, ds.filter((d) => !!d.causa_raiz).length),
      recaidas,
      pctRecaida: pct(recaidas, comMedidaDisc.length),
      serie: serieMensal(ds, meses === "tudo" ? 24 : Number(meses)),
      porTipo: contarPor(ds, tipoEfetivo, (k) => rotulo(LABEL_TIPO, k)),
      porGravidade: contarPor(ds, (d) => d.gravidade, (k) => rotulo(LABEL_GRAVIDADE, k)),
      porContrato: contarPor(ds, (d) => d.contrato, (k) => k),
      porSetor: contarPor(ds, (d) => d.setor, (k) => k),
      porLider: contarPor(ds, (d) => d.lider_nome, (k) => k),
      porLocal: contarPor(ds, (d) => [d.cidade, d.unidade].filter(Boolean).join(" · "), (k) => k),
      porOrigem: contarPor(ds, (d) => d.origem, (k) => rotulo(LABEL_ORIGEM, k)),
      porCausa: contarPor(ds.filter((d) => !!d.causa_raiz), (d) => d.causa_raiz, (k) => rotulo(LABEL_CAUSA, k)),
      porResultado: contarPor(comResultado, (d) => d.resultado, (k) => rotulo(LABEL_RESULTADO, k)),
      medidasContagem,
      reincColab, reincLider, reincContrato,
      pendentes: abertas
        .map((d) => ({ d, restam: diasRestantes(d, slas) ?? 0 }))
        .sort((a, b) => a.restam - b.restam),
    };
  }, [ds, slas, meses]);

  if (!isLoading && todas.length === 0) {
    return (
      <div>
        <Cabecalho nav={nav} />
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <FileWarning className="h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-bold">Ainda não há denúncias registradas</p>
          <p className="max-w-lg text-sm text-muted-foreground">
            Os indicadores aparecem aqui automaticamente conforme os casos forem registrados e
            apurados. A estrutura já está pronta: cada ficha preenchida em Denúncias alimenta este
            painel — não há nenhuma carga ou parametrização adicional a fazer.
          </p>
          <Button variant="outline" onClick={() => nav("/app/comite-etica/denuncias")}>
            Ir para Denúncias
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Cabecalho nav={nav} />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recorte</span>
        <Select value={meses} onValueChange={setMeses}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
            <SelectItem value="24">Últimos 24 meses</SelectItem>
            <SelectItem value="tudo">Todo o período</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fContrato} onValueChange={setFContrato}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os contratos</SelectItem>
            {contratos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fSetor} onValueChange={setFSetor}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os setores</SelectItem>
            {setores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {m.total} denúncia(s) no recorte
        </span>
      </Card>

      {/* ------------------------------------------------------------ KPIs */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Inbox} tom="text-primary" valor={String(m.total)} label="Denúncias no período" />
        <Kpi icon={Clock} tom="text-info" valor={fmtDias(m.tempoMedio)} label="Tempo médio de conclusão"
             nota={m.concluidas === 0 ? "nenhuma concluída ainda" : `${m.concluidas} concluída(s)`} />
        <Kpi icon={ShieldCheck} tom="text-success" valor={fmtPct(m.pctSla)} label="Dentro do SLA"
             nota={m.semSla > 0 ? `${m.semSla} sem prazo apurável` : undefined} />
        <Kpi icon={TimerOff} tom="text-destructive" valor={String(m.vencidas)} label="Casos vencidos"
             nota={`${m.abertas} em aberto`} />
        <Kpi icon={Gavel} tom="text-destructive" valor={fmtPct(m.pctProcedente)} label="Procedentes"
             nota={m.semResultado > 0 ? `${m.semResultado} sem resultado lançado` : undefined} />
        <Kpi icon={ShieldCheck} tom="text-success" valor={fmtPct(m.pctImprocedente)} label="Improcedentes" />
        <Kpi icon={TrendingUp} tom="text-warning" valor={fmtDias(m.tempoPrimeira)} label="Até a 1ª providência"
             nota={m.semPrimeira > 0 ? `${m.semPrimeira} sem data lançada` : undefined} />
        <Kpi icon={Repeat} tom="text-warning" valor={fmtPct(m.pctRecaida)} label="Reincidência após medida"
             nota={m.disciplinares === 0 ? "nenhuma medida aplicada ainda" : `${m.recaidas} de ${m.disciplinares}`} />
        <Kpi icon={Gavel} tom="text-destructive" valor={String(m.disciplinares)} label="Medidas disciplinares"
             nota="advertência, suspensão ou demissão" />
        <Kpi icon={GraduationCap} tom="text-info" valor={String(m.treinamentos)} label="Treinamentos decorrentes"
             nota="casos que geraram capacitação" />
      </div>

      {/* ------------------------------------------------------- evolução */}
      <Painel titulo="Evolução mensal" icone={TrendingUp}
              desc="Total de denúncias abertas por mês — a linha de tendência do canal.">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={m.serie} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TIP} />
            <Line type="monotone" dataKey="total" name="Denúncias" stroke="#0f3171" strokeWidth={2.5}
                  dot={{ r: 3 }} activeDot={{ r: 5 }}>
              <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: "#64748b" }} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </Painel>

      {/* --------------------------------------------------- distribuições */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Painel titulo="Por tipo de denúncia" icone={ListChecks}
                desc="Classificação do comitê (quando houver), não a do denunciante.">
          <Barras dados={m.porTipo} />
        </Painel>

        <Painel titulo="Por gravidade" icone={FileWarning} desc="Distribuição do risco dos casos.">
          <Pizza dados={m.porGravidade} cores={m.porGravidade.map((x) => COR_GRAVIDADE[x.chave] ?? "#94a3b8")} />
        </Painel>

        <Painel titulo="Por contrato" icone={Building2} desc="Onde o risco se concentra comercialmente.">
          <Barras dados={m.porContrato} />
        </Painel>

        <Painel titulo="Ranking de setores" icone={ListChecks} desc="Setores com mais ocorrências.">
          <Barras dados={m.porSetor} />
        </Painel>

        <Painel titulo="Por líder" icone={Users} desc="Liderança imediata dos casos registrados.">
          <Barras dados={m.porLider} />
        </Painel>

        <Painel titulo="Por cidade / unidade" icone={Building2} desc="Recorte geográfico.">
          <Barras dados={m.porLocal} />
        </Painel>

        <Painel titulo="Principais causas raiz" icone={HelpCircle}
                desc="O que explica o caso — base para agir no sistema, não só na pessoa.">
          <Barras dados={m.porCausa} />
        </Painel>

        <Painel titulo="Resultado das apurações" icone={Gavel} desc="Só casos já julgados.">
          <Pizza dados={m.porResultado} cores={m.porResultado.map((x) => COR_RESULTADO[x.chave] ?? "#94a3b8")} />
        </Painel>

        <Painel titulo="Por origem" icone={Inbox} desc="Por onde as denúncias chegam.">
          <Barras dados={m.porOrigem} />
        </Painel>

        <Painel titulo="Medidas aplicadas" icone={Gavel}
                desc={`${m.disciplinares} caso(s) com medida disciplinar · ${m.treinamentos} com treinamento.`}>
          <Barras dados={m.medidasContagem} />
        </Painel>
      </div>

      {/* -------------------------------------------------- reincidências */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <TabelaReincidencia titulo="Reincidência por colaborador" icone={Repeat}
          desc="Denunciados com mais de um caso. Sem vínculo ao RH, o caso não entra nesta conta."
          linhas={m.reincColab} />
        <TabelaReincidencia titulo="Reincidência por líder" icone={Users}
          desc="Lideranças que aparecem em mais de um caso."
          linhas={m.reincLider} />
        <TabelaReincidencia titulo="Reincidência por contrato" icone={Building2}
          desc="Contratos com ocorrência repetida."
          linhas={m.reincContrato} />
      </div>

      {/* ---------------------------------------------- fila de pendentes */}
      <Painel titulo="Casos pendentes e vencidos" icone={TimerOff}
              desc="Em aberto, do mais atrasado para o menos. Clique para abrir a ficha.">
        {m.pendentes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum caso em aberto.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Protocolo</TableHead>
                  <TableHead>Aberta em</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Gravidade</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.pendentes.slice(0, 25).map(({ d, restam }) => (
                  <TableRow key={d.id} className="cursor-pointer"
                            onClick={() => nav("/app/comite-etica/denuncias")}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{d.protocolo}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtData(d.created_at)}</TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_TIPO, tipoEfetivo(d))}</TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_GRAVIDADE, d.gravidade)}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs">{d.contrato || "—"}</TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_SITUACAO, d.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {restam < 0
                        ? <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] font-bold text-destructive">
                            venceu há {Math.abs(restam)} d
                          </Badge>
                        : <span className={restam <= 3 ? "font-semibold text-warning" : "text-muted-foreground"}>{restam} d</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {m.pendentes.length > 25 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Mostrando os 25 mais atrasados de {m.pendentes.length}.
              </p>
            )}
          </div>
        )}
      </Painel>

      {/* ------------------------------------- as perguntas da diretoria */}
      <Painel titulo="Leitura estratégica" icone={HelpCircle}
              desc="As perguntas que o comitê precisa responder com dado, e o que os números dizem hoje.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Resposta
            pergunta="Quais líderes concentram mais problemas éticos?"
            resposta={m.porLider.filter((x) => x.chave !== "__vazio__").slice(0, 3)
              .map((x) => `${x.label} (${x.total})`).join(" · ")}
            vazio="Nenhum caso com líder imediato informado."
          />
          <Resposta
            pergunta="Quais contratos apresentam maior risco?"
            resposta={m.porContrato.filter((x) => x.chave !== "__vazio__").slice(0, 3)
              .map((x) => `${x.label} (${x.total})`).join(" · ")}
            vazio="Nenhum caso com contrato informado."
          />
          <Resposta
            pergunta="Os treinamentos reduziram as ocorrências?"
            resposta={m.treinamentos > 0
              ? `${m.treinamentos} caso(s) geraram treinamento. Compare a evolução mensal antes e depois — a série acima é o teste.`
              : ""}
            vazio="Nenhum treinamento aplicado como medida ainda."
          />
          <Resposta
            pergunta="As medidas disciplinares estão sendo eficazes?"
            resposta={m.disciplinares > 0
              ? `${m.recaidas} reincidência(s) depois de medida, em ${m.disciplinares} caso(s) com medida disciplinar — ${fmtPct(m.pctRecaida)} de recaída.`
              : ""}
            vazio="Nenhuma medida disciplinar aplicada ainda."
          />
          <Resposta
            pergunta="Existem padrões de falha de processo, e não só de comportamento?"
            resposta={m.sistemicas !== null
              ? `${fmtPct(m.sistemicas)} das causas raiz apontam para o sistema (liderança, processo, comunicação, treinamento ou clima) e não para conduta individual.`
              : ""}
            vazio="Nenhuma causa raiz classificada ainda."
          />
          <Resposta
            pergunta="O canal está respondendo rápido?"
            resposta={m.tempoPrimeira !== null
              ? `Primeira providência em ${fmtDias(m.tempoPrimeira)} em média; ${fmtPct(m.pctSla)} dos casos concluídos ficaram dentro do prazo.`
              : ""}
            vazio="Nenhuma data de primeira providência lançada ainda."
          />
        </div>
      </Painel>
    </div>
  );
}

// ------------------------------------------------------------- auxiliares
function Cabecalho({ nav }: { nav: ReturnType<typeof useNavigate> }) {
  return (
    <PageHeader
      title="Indicadores"
      subtitle="Gestão de risco ético: tendências, reincidência, tempo de tratamento e efetividade das decisões."
      module="Comitê de Ética"
      breadcrumb={["Comitê de Ética", "Indicadores"]}
      actions={
        <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/comite-etica/denuncias")}>
          <Inbox className="h-4 w-4" /> Denúncias
        </Button>
      }
    />
  );
}

function Kpi({ icon: Icone, tom, valor, label, nota }: {
  icon: React.ComponentType<{ className?: string }>;
  tom: string; valor: string; label: string; nota?: string;
}) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <Icone className={`mt-0.5 h-5 w-5 shrink-0 ${tom}`} />
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{valor}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        {nota && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{nota}</p>}
      </div>
    </Card>
  );
}

function Painel({ titulo, desc, icone: Icone, children }: {
  titulo: string; desc?: string;
  icone: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-4 p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <Icone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-bold">{titulo}</p>
          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

/** Barras horizontais: rótulo de setor/contrato é longo e não cabe no eixo X. */
function Barras({ dados }: { dados: { chave: string; label: string; total: number }[] }) {
  if (!dados.length) return <Vazio />;
  const top = dados.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={Math.max(150, top.length * 34 + 24)}>
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 34, left: 6, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} interval={0} />
        <Tooltip contentStyle={TIP} />
        <Bar dataKey="total" name="Denúncias" radius={[0, 5, 5, 0]}>
          {top.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
          <LabelList dataKey="total" position="right" style={{ fontSize: 11, fill: "#475569", fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Pizza({ dados, cores }: {
  dados: { chave: string; label: string; total: number }[]; cores: string[];
}) {
  if (!dados.length) return <Vazio />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ResponsiveContainer width="100%" height={200} className="!w-[55%] min-w-[180px]">
        <PieChart>
          <Pie data={dados} dataKey="total" nameKey="label" innerRadius={44} outerRadius={78} paddingAngle={2}>
            {dados.map((_, i) => <Cell key={i} fill={cores[i] ?? CORES[i % CORES.length]} />)}
          </Pie>
          <Tooltip contentStyle={TIP} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {dados.map((x, i) => (
          <div key={x.chave} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: cores[i] ?? CORES[i % CORES.length] }} />
            <span className="min-w-0 flex-1 truncate">{x.label}</span>
            <b>{x.total}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabelaReincidencia({ titulo, desc, icone: Icone, linhas }: {
  titulo: string; desc: string;
  icone: React.ComponentType<{ className?: string }>;
  linhas: { chave: string; label: string; total: number; procedentes: number; aposMedida: number; ultima: string }[];
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <Icone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-bold">{titulo}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma reincidência registrada.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs"></TableHead>
              <TableHead className="text-xs">Casos</TableHead>
              <TableHead className="text-xs">Proced.</TableHead>
              <TableHead className="text-xs">Pós-medida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.slice(0, 8).map((r) => (
              <TableRow key={r.chave}>
                <TableCell className="max-w-[150px] truncate text-xs font-medium">{r.label}</TableCell>
                <TableCell className="text-xs font-bold">{r.total}</TableCell>
                <TableCell className="text-xs">{r.procedentes}</TableCell>
                <TableCell className="text-xs">
                  {r.aposMedida > 0
                    ? <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] font-bold text-destructive">
                        {r.aposMedida}
                      </Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function Resposta({ pergunta, resposta, vazio }: { pergunta: string; resposta: string; vazio: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-bold">{pergunta}</p>
      <p className={`mt-1 text-xs ${resposta ? "text-foreground" : "italic text-muted-foreground"}`}>
        {resposta || vazio}
      </p>
    </div>
  );
}

function Vazio() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Sem dados para este indicador no recorte selecionado.
    </p>
  );
}
