import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileText, LogIn, Loader2, PlayCircle, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import {
  buscarTodaParticipacaoIndividual, useTrnCursos, useTrnParticipacaoIndividual, useTrnParticipacaoResumo,
} from "@/hooks/useTreinamentosPlataforma";
import {
  EMPRESAS_PARTICIPACAO, ROTULO_SITUACAO, dataBr, dataHoraBr, descreverFiltros, diaBrasilia, pctConclusao, pctTexto,
  type FiltrosParticipacao, type MetricasParticipacao, type SituacaoParticipacao,
} from "@/lib/treinamentos/participacaoVideos";
import { MENU } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnKpi } from "./ui";

// =====================================================================
// TREINAMENTOS — Participação nos vídeos (SIS-2026-0914, 17/11/2026).
//
// Pedido do Jurídico (resposta a notificação, prazo 25/11/2026): por vídeo,
// quem deveria ter feito o treinamento, quem acessou, quem assistiu até o
// fim, quem acessou e não concluiu, quem não acessou, % de conclusão; o
// relatório individual; e a CONSULTA POR DATA — a situação até um dia, sem
// contar o que veio depois. Tudo por PESSOA (Empresa + Cadastro): abrir o
// vídeo dez vezes continua sendo uma pessoa.
//
// A regra mora no banco (mig 20261117091400) e, espelhada, em
// src/lib/treinamentos/participacaoVideos.ts (com teste). Mesma porta do
// Dashboard de Treinamentos: a rota fica debaixo de /app/treinamentos.
// =====================================================================

const TODOS = "__todos";
const POR_PAGINA = 100;
// PDF com dezenas de milhares de linhas trava o navegador (são milhares de
// páginas). Acima disto, o PDF não sai cortado: pede para filtrar ou usar o Excel.
const MAX_LINHAS_PDF = 8000;
const hoje = () => diaBrasilia(new Date().toISOString());
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");

// Uma quantidade ordenada (não iniciou → acessou → concluiu): um tom só, do
// claro ao escuro, e cinza neutro para "não acessou" (skill dataviz).
const COR = { concluiu: "#c2410c", andamento: "#fdba74", nao: "#e2e8f0" };

const SITUACOES: SituacaoParticipacao[] = ["nao_iniciado", "em_andamento", "concluido"];
const CLASSE_SITUACAO: Record<SituacaoParticipacao, string> = { concluido: "ok", em_andamento: "warn", nao_iniciado: "off" };

export default function ParticipacaoVideos() {
  const { user } = useAuth();
  const [data, setData] = useState(hoje);
  const [curso, setCurso] = useState<string | null>(null);
  const [aula, setAula] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<number | null>(null);
  const [contrato, setContrato] = useState<string | null>(null);
  const [cargo, setCargo] = useState<string | null>(null);
  const filtros: FiltrosParticipacao = useMemo(
    () => ({ data: data || hoje(), curso, aula, empresa, contrato, cargo }),
    [data, curso, aula, empresa, contrato, cargo],
  );

  const [situacao, setSituacao] = useState<SituacaoParticipacao | null>(null);
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  useEffect(() => { const t = setTimeout(() => setBusca(buscaDigitada), 400); return () => clearTimeout(t); }, [buscaDigitada]);
  useEffect(() => { setPagina(0); }, [filtros, situacao, busca]);

  const { data: cursos = [] } = useTrnCursos();
  const resumoQ = useTrnParticipacaoResumo(filtros);
  const indQ = useTrnParticipacaoIndividual(filtros, { situacao, busca, limite: POR_PAGINA, offset: pagina * POR_PAGINA });
  const r = resumoQ.data;
  const [opcoes, setOpcoes] = useState<NonNullable<typeof r>["opcoes"] | null>(null);
  useEffect(() => { if (r?.opcoes) setOpcoes(r.opcoes); }, [r]);

  const cursosPublicados = useMemo(() => cursos.filter((c) => c.publicado), [cursos]);
  const videosDoCurso = useMemo(
    () => (opcoes?.videos ?? []).filter((v) => !curso || v.curso_id === curso),
    [opcoes, curso],
  );
  const nomeCurso = cursos.find((c) => c.id === curso)?.nome ?? null;
  const nomeAula = opcoes?.videos.find((v) => v.id === aula)?.nome ?? null;
  const filtrando = !!(curso || aula || empresa != null || contrato || cargo || data !== hoje());

  const limpar = () => { setData(hoje()); setCurso(null); setAula(null); setEmpresa(null); setContrato(null); setCargo(null); };

  const [exportando, setExportando] = useState<"xlsx" | "pdf" | null>(null);
  const exportar = async (tipo: "xlsx" | "pdf") => {
    if (!r) return;
    setExportando(tipo);
    try {
      if (tipo === "pdf" && totalInd > MAX_LINHAS_PDF) {
        toast.error(`O relatório individual tem ${num(totalInd)} linhas — grande demais para PDF. Filtre por treinamento, empresa ou contrato, ou exporte em Excel.`);
        return;
      }
      const individual = await buscarTodaParticipacaoIndividual(filtros, { situacao, busca });
      const mod = await import("@/lib/treinamentos/participacaoVideosExportar");
      const conteudo = {
        resumo: r, individual, data: r.data,
        filtros: descreverFiltros(filtros, { curso: nomeCurso, aula: nomeAula }, { situacao, busca }),
        geradoPor: user?.email ?? null,
      };
      if (tipo === "xlsx") await mod.exportarParticipacaoExcel(conteudo);
      else await mod.exportarParticipacaoPdf(conteudo);
    } catch (e) {
      toast.error("Não deu para exportar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportando(null);
    }
  };

  const t = r?.totais;
  const pctPessoas = t && t.pessoas > 0 ? Math.round((t.concluiram_tudo / t.pessoas) * 1000) / 10 : 0;
  const totalInd = indQ.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(totalInd / POR_PAGINA));

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.dashboard} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o Dashboard de Treinamentos.</Card>}>
        <TrnHero
          titulo="Participação nos vídeos"
          texto="Quem deveria ter feito cada vídeo de treinamento, quem acessou e quem assistiu até o fim — por pessoa (Empresa + Cadastro), não por visualização. Escolha uma data para ver a situação até aquele dia."
          pilulas={r ? [`Situação até ${dataBr(r.data)}`, `${num(t?.pessoas)} pessoa(s)`, `${num(t?.videos)} vídeo(s)`] : undefined}
          acoes={<>
            <button onClick={() => exportar("xlsx")} disabled={!r || !!exportando}>
              {exportando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
            </button>
            <button onClick={() => exportar("pdf")} disabled={!r || !!exportando}>
              {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
            </button>
            <Link to="/app/treinamentos" className="sec"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
          </>}
        />

        {/* Filtros — uma faixa só, acima de tudo */}
        <div className="trn-card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Campo rotulo="Situação até">
            <Input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value || hoje())} />
          </Campo>
          <Campo rotulo="Treinamento">
            <Select value={curso ?? TODOS} onValueChange={(v) => { setCurso(v === TODOS ? null : v); setAula(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os treinamentos</SelectItem>
                {cursosPublicados.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Vídeo">
            <Select value={aula ?? TODOS} onValueChange={(v) => setAula(v === TODOS ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os vídeos</SelectItem>
                {videosDoCurso.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Empresa">
            <Select value={empresa != null ? String(empresa) : TODOS} onValueChange={(v) => setEmpresa(v === TODOS ? null : Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {EMPRESAS_PARTICIPACAO.map((e) => <SelectItem key={e.codigo} value={String(e.codigo)}>{e.sigla}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Contrato / unidade">
            <Select value={contrato ?? TODOS} onValueChange={(v) => setContrato(v === TODOS ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(opcoes?.contratos ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Cargo / função">
            <Select value={cargo ?? TODOS} onValueChange={(v) => setCargo(v === TODOS ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(opcoes?.cargos ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          {filtrando && (
            <button className="text-left text-xs font-semibold text-primary sm:col-span-2 lg:col-span-3 xl:col-span-6" onClick={limpar}>
              Limpar filtros (volta para hoje)
            </button>
          )}
        </div>

        {resumoQ.error ? (
          <Card className="p-6 text-sm text-red-700">Não deu para carregar: {(resumoQ.error as Error).message}</Card>
        ) : !r || !t ? <TrnCarregando texto="Calculando a participação…" /> : (
          <>
            <div className="trn-kpis">
              <TrnKpi rotulo="Deveriam realizar" valor={num(t.pessoas)} sub={`pessoas ativas em ${dataBr(r.data)} no público`} icone={<Users className="h-5 w-5" />} />
              <TrnKpi rotulo="Acessaram" valor={num(t.acessaram)} sub={`${pctTexto(t.pessoas ? Math.round((t.acessaram / t.pessoas) * 1000) / 10 : 0)} abriram ao menos um vídeo`} icone={<LogIn className="h-5 w-5" />} />
              <TrnKpi rotulo="Concluíram tudo" valor={num(t.concluiram_tudo)} sub={<><b className="text-orange-700">{pctTexto(pctPessoas)}</b> assistiram todos os vídeos que lhes cabiam</>} icone={<CheckCircle2 className="h-5 w-5" />} />
              <TrnKpi rotulo="Acessaram e não concluíram" valor={num(t.em_andamento)} sub="faltou algum vídeo até o fim" icone={<PlayCircle className="h-5 w-5" />} />
              <TrnKpi rotulo="Não acessaram" valor={num(t.nao_acessaram)} sub="nenhum vídeo aberto até a data" icone={<UserX className="h-5 w-5" />} />
            </div>

            <div className="trn-card">
              <h3>Por vídeo</h3>
              <div className="sub">Pessoas distintas por vídeo, situação até {dataBr(r.data)}. Vídeo cadastrado depois da data não aparece.</div>
              <Legenda />
              {r.por_video.length === 0 ? <div className="trn-vazio">Nenhum vídeo neste recorte.</div> : (
                <div className="overflow-x-auto">
                  <table className="trn-tab">
                    <thead>
                      <tr>
                        <th>Vídeo</th>
                        <th className="text-right">Deveriam</th>
                        <th className="text-right">Acessaram</th>
                        <th className="text-right">Até o fim</th>
                        <th className="text-right">Acessaram, não concluíram</th>
                        <th className="text-right">Não acessaram</th>
                        <th className="min-w-[180px]">% conclusão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.por_video.map((v) => (
                        <tr key={v.aula_id}>
                          <td>
                            <div className="font-bold text-slate-800">{v.aula}</div>
                            <div className="text-[11px] text-slate-400">{v.curso}</div>
                          </td>
                          <td className="text-right font-semibold">{num(v.publico)}</td>
                          <td className="text-right">{num(v.acessaram)}</td>
                          <td className="text-right">{num(v.concluiram)}</td>
                          <td className="text-right">{num(v.acessaram_nao_concluiram)}</td>
                          <td className="text-right">{num(v.nao_acessaram)}</td>
                          <td><BarraSituacao m={v} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {r.por_treinamento.length > 1 && (
              <div className="trn-card mt-4">
                <h3>Por treinamento</h3>
                <div className="sub">Concluiu o treinamento = assistiu até o fim todos os vídeos dele que existiam na data.</div>
                <div className="overflow-x-auto">
                  <table className="trn-tab">
                    <thead>
                      <tr>
                        <th>Treinamento</th>
                        <th className="text-right">Vídeos</th>
                        <th className="text-right">Deveriam</th>
                        <th className="text-right">Acessaram</th>
                        <th className="text-right">Concluíram</th>
                        <th className="text-right">Não acessaram</th>
                        <th className="min-w-[180px]">% conclusão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.por_treinamento.map((c) => (
                        <tr key={c.curso_id}>
                          <td className="font-bold text-slate-800">{c.curso}</td>
                          <td className="text-right">{num(c.videos)}</td>
                          <td className="text-right font-semibold">{num(c.publico)}</td>
                          <td className="text-right">{num(c.acessaram)}</td>
                          <td className="text-right">{num(c.concluiram)}</td>
                          <td className="text-right">{num(c.nao_acessaram)}</td>
                          <td><BarraSituacao m={c} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Relatório individual ─────────────────────────────────── */}
        <div className="trn-card mt-4">
          <h3>Relatório individual</h3>
          <div className="sub">
            Uma linha por colaborador e treinamento{aula ? " (só o vídeo escolhido)" : ""}. Datas em horário de Brasília; conclusão só aparece quando todos os vídeos foram vistos até o fim até {dataBr(filtros.data)}.
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_220px]">
            <Input placeholder="Buscar por nome ou cadastro…" value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} />
            <Select value={situacao ?? TODOS} onValueChange={(v) => setSituacao(v === TODOS ? null : (v as SituacaoParticipacao))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas as situações</SelectItem>
                {SITUACOES.map((s) => <SelectItem key={s} value={s}>{ROTULO_SITUACAO[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {indQ.error ? <div className="text-sm text-red-700">Não deu para carregar: {(indQ.error as Error).message}</div>
            : !indQ.data ? <TrnCarregando /> : indQ.data.linhas.length === 0 ? <div className="trn-vazio">Ninguém neste filtro.</div> : (
            <>
              <div className={`overflow-x-auto ${indQ.isFetching ? "opacity-60" : ""}`}>
                <table className="trn-tab">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Empresa / contrato</th>
                      <th>Treinamento</th>
                      <th>Primeiro acesso</th>
                      <th>Conclusão</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indQ.data.linhas.map((l) => (
                      <tr key={`${l.pessoa}-${l.curso_id}`}>
                        <td>
                          <div className="font-bold text-slate-800">{l.nome}</div>
                          <div className="text-[11px] text-slate-400">Cadastro {l.cadastro}{l.cargo ? ` · ${l.cargo}` : ""}</div>
                        </td>
                        <td>
                          <div className="font-semibold">{l.empresa}</div>
                          <div className="text-[11px] text-slate-400">{l.contrato ?? "—"}</div>
                        </td>
                        <td>
                          <div>{l.curso}</div>
                          <div className="text-[11px] text-slate-400">{l.concluidos} de {l.videos} vídeo(s) até o fim</div>
                        </td>
                        <td className="whitespace-nowrap">{dataHoraBr(l.primeiro_acesso) || "—"}</td>
                        <td className="whitespace-nowrap">{dataHoraBr(l.conclusao) || "—"}</td>
                        <td><span className={`trn-badge ${CLASSE_SITUACAO[l.situacao]}`}>{ROTULO_SITUACAO[l.situacao]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{num(totalInd)} linha(s) · página {pagina + 1} de {paginas}</span>
                <span className="flex gap-2">
                  <button className="rounded border px-3 py-1 font-semibold disabled:opacity-40" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                  <button className="rounded border px-3 py-1 font-semibold disabled:opacity-40" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
                </span>
              </div>
            </>
          )}
        </div>

        <div className="trn-ajuda mt-4">
          <h4>Como os números são contados</h4>
          <p>
            <b>Pessoa</b> é a combinação Empresa + Cadastro da Senior: abrir o vídeo várias vezes conta uma vez só.{" "}
            <b>Deveriam realizar</b> são os colaboradores já admitidos e ainda não desligados na data escolhida (quem saiu depois
            conta; quem entrou depois não), a quem o treinamento estava liberado — ou que abriram o vídeo.{" "}
            <b>Acessou</b> = primeiro acesso até a data; <b>até o fim</b> = vídeo assistido até o fim (ou aula concluída) até a data —
            o que aconteceu depois não entra.
          </p>
          <h5>Limites</h5>
          <p>
            Contrato e cargo são os do cadastro atual (não há histórico de transferência). A data do primeiro acesso é exata desde
            05/10/2026; antes disso usa o primeiro registro de progresso, que nunca é anterior ao acesso real. A data do "vídeo
            assistido até o fim" passou a ser gravada em 17/11/2026; as anteriores usam o registro mais próximo (também nunca antes do fato).
          </p>
        </div>
      </AcessoGate>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{rotulo}</label>
      {children}
    </div>
  );
}

function Legenda() {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
      {[["Assistiram até o fim", COR.concluiu], ["Acessaram, não concluíram", COR.andamento], ["Não acessaram", COR.nao]].map(([n, c]) => (
        <span key={n} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{n}</span>
      ))}
    </div>
  );
}

/** Barra empilhada fina: concluiu / acessou sem concluir / não acessou, com o % de conclusão ao lado. */
function BarraSituacao({ m }: { m: MetricasParticipacao }) {
  const p = (n: number) => (m.publico > 0 ? (n / m.publico) * 100 : 0);
  const partes = [
    { n: m.concluiram, cor: COR.concluiu, rot: "Assistiram até o fim" },
    { n: m.acessaram_nao_concluiram, cor: COR.andamento, rot: "Acessaram, não concluíram" },
    { n: m.nao_acessaram, cor: COR.nao, rot: "Não acessaram" },
  ].filter((x) => x.n > 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full bg-slate-100">
        {partes.map((x) => (
          <div key={x.rot} title={`${x.rot}: ${num(x.n)} (${pctTexto(Math.round(p(x.n) * 10) / 10)})`} style={{ width: `${p(x.n)}%`, background: x.cor }} />
        ))}
      </div>
      <b className="w-12 text-right text-xs text-slate-800">{pctTexto(pctConclusao(m))}</b>
    </div>
  );
}
