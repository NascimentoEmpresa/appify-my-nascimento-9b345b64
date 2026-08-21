import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, Copy, Check, Search, Link2, UserX, User, Inbox, Gavel, BarChart3, TimerOff,
  PauseCircle, BellRing, Settings2, X,
} from "lucide-react";
import {
  SITUACAO, GRAVIDADE, RESULTADO, LABEL_SITUACAO, LABEL_TIPO, LABEL_RELACAO,
  LABEL_GRAVIDADE, LABEL_RESULTADO, COR_GRAVIDADE, rotulo,
} from "./vocabulario";
import {
  type Alerta, type Denuncia, type RegraSla, concluida, diasParado, diasRestantes,
  parada, tipoEfetivo, vencida,
} from "./metricas";
import FichaDenuncia from "./FichaDenuncia";
import { ExportarLista } from "./ExportarDenuncia";
import { TIPO_ALERTA } from "./vocabulario";

// =====================================================================
// COMITÊ DE ÉTICA — Denúncias recebidas pelo canal próprio
//
// O que chega aqui vem do formulário público /denuncia (sem login), via
// RPC denuncia_registrar. Esta tela é a fila de trabalho: ler, classificar,
// apurar e registrar o desfecho — a ficha inteira vive em FichaDenuncia.
//
// Quem enxerga: só quem tem o menu 'central_servicos_canal_denuncias'
// liberado em Acesso por Usuário. O relato é imutável pela API (trigger no
// banco); da ficha só saem os campos da apuração.
// =====================================================================

// Cor por FASE, não por nome: entrou (azul), o Comitê está trabalhando
// (âmbar), a bola está com outro (âmbar mais claro), decidido (azul forte),
// fechado (cinza). Situação sem entrada aqui cai no neutro e continua legível.
const CLS_SITUACAO: Record<string, string> = {
  nova: "border-info/30 bg-info/10 text-info",
  triagem: "border-info/30 bg-info/10 text-info",
  investigacao: "border-warning/30 bg-warning/10 text-warning",
  aguardando_esclarecimentos: "border-warning/30 bg-warning/10 text-warning",
  aguardando_documentos: "border-warning/30 bg-warning/10 text-warning",
  parecer_elaboracao: "border-primary/30 bg-primary/10 text-primary",
  aguardando_presidencia: "border-primary/30 bg-primary/10 text-primary",
  aguardando_cumprimento: "border-primary/30 bg-primary/10 text-primary",
  concluida: "border-border bg-muted text-muted-foreground",
  arquivada: "border-border bg-muted text-muted-foreground",
  reaberta: "border-destructive/30 bg-destructive/10 text-destructive",
};

const CLS_RESULTADO: Record<string, string> = {
  procedente: "border-destructive/30 bg-destructive/10 text-destructive",
  parcialmente_procedente: "border-warning/30 bg-warning/10 text-warning",
  improcedente: "border-success/30 bg-success/10 text-success",
  arquivada: "border-border bg-muted text-muted-foreground",
};

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export default function DenunciasComiteEtica() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("todos");
  const [fGravidade, setFGravidade] = useState("todas");
  const [fResultado, setFResultado] = useState("todos");
  const [fEmpresa, setFEmpresa] = useState("todas");
  const [fContrato, setFContrato] = useState("todos");
  const [fResponsavel, setFResponsavel] = useState("todos");
  const [fPeriodo, setFPeriodo] = useState("tudo");
  /** "" | "risco" | "vencidas" | "paradas" — os recortes que são conta, não campo. */
  const [fAtencao, setFAtencao] = useState("");
  const [alvo, setAlvo] = useState<Denuncia | null>(null);
  const [copiou, setCopiou] = useState(false);

  const { data: denuncias = [], isLoading } = useQuery({
    queryKey: ["canal-denuncias"],
    queryFn: async () => {
      // Lê da VISÃO, não da tabela: é ela que mascara a identidade do
      // denunciante para quem não tem `comite_etica_sigilo` (a tabela nem
      // concede SELECT à aplicação desde a 20260914000002).
      const { data, error } = await db
        .from("v_canal_denuncia").select("*").order("created_at", { ascending: false });
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

  // O link do formulário público. Vive no mesmo domínio do ERP, então sai do
  // próprio endereço da página — não tem constante para desatualizar.
  const linkPublico = `${window.location.origin}/denuncia`;

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkPublico);
      setCopiou(true);
      setTimeout(() => setCopiou(false), 2000);
      toast({ title: "Link copiado", description: linkPublico });
    } catch {
      toast({ title: "Não consegui copiar", description: linkPublico, variant: "destructive" });
    }
  };

  /**
   * As listas dos selects saem dos próprios dados: contrato e empresa que
   * ninguém usou não têm o que fazer no filtro.
   *
   * As três saem de um `useMemo` só porque varrem a MESMA lista — três
   * passagens separadas sobre o mesmo array não pagam a legibilidade.
   */
  const { empresas, contratos, responsaveis } = useMemo(() => {
    const distintos = (f: (d: Denuncia) => string | null | undefined) =>
      [...new Set(denuncias.map(f).filter((v): v is string => !!v && !!v.trim()))].sort();
    return {
      empresas: distintos((d) => d.empresa_nome),
      contratos: distintos((d) => d.contrato || d.contrato_informado),
      responsaveis: distintos((d) => d.apuracao_responsavel),
    };
  }, [denuncias]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const corte = fPeriodo === "tudo"
      ? null
      : new Date(Date.now() - Number(fPeriodo) * 86_400_000);
    return denuncias.filter((d) => {
      if (fStatus !== "todos" && d.status !== fStatus) return false;
      if (fGravidade !== "todas" && (d.gravidade ?? "") !== fGravidade) return false;
      if (fResultado !== "todos" && (d.resultado ?? "") !== fResultado) return false;
      if (fEmpresa !== "todas" && (d.empresa_nome ?? "") !== fEmpresa) return false;
      if (fContrato !== "todos" && (d.contrato || d.contrato_informado || "") !== fContrato) return false;
      if (fResponsavel === "__sem" && (d.apuracao_responsavel ?? "").trim()) return false;
      if (fResponsavel !== "todos" && fResponsavel !== "__sem"
          && (d.apuracao_responsavel ?? "") !== fResponsavel) return false;
      if (corte && new Date(d.created_at) < corte) return false;
      if (fAtencao === "risco" && !d.risco_imediato) return false;
      if (fAtencao === "vencidas" && !vencida(d, slas)) return false;
      if (fAtencao === "paradas" && !parada(d, slas)) return false;
      if (!t) return true;
      return [d.protocolo, d.titulo, d.resumo, d.descricao, d.local_ocorrencia, d.nome_completo,
              d.denunciado_nome, d.denunciado_informado, d.lider_nome, d.empresa_nome,
              d.contrato, d.contrato_informado, d.setor, d.cidade, d.apuracao_responsavel]
        .some((c) => (c ?? "").toString().toLowerCase().includes(t));
    });
  }, [denuncias, busca, fStatus, fGravidade, fResultado, fEmpresa, fContrato,
      fResponsavel, fPeriodo, fAtencao, slas]);

  const kpis = useMemo(() => {
    const abertas = denuncias.filter((d) => !concluida(d));
    return {
      total: denuncias.length,
      novas: denuncias.filter((d) => d.status === "nova").length,
      andamento: abertas.filter((d) => d.status !== "nova").length,
      vencidas: abertas.filter((d) => vencida(d, slas)).length,
      paradas: abertas.filter((d) => parada(d, slas)).length,
      risco: abertas.filter((d) => d.risco_imediato).length,
    };
  }, [denuncias, slas]);

  // Os alertas que o tick diário acendeu e ninguém deu baixa ainda.
  const { data: alertas = [] } = useQuery({
    queryKey: ["canal-denuncias-alertas"],
    queryFn: async () => {
      const { data, error } = await db.from("CANAL_DENUNCIA_ALERTA")
        .select("*").is("resolvido_em", null).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Alerta[];
    },
  });

  const darBaixa = async (a: Alerta) => {
    const { error } = await db.from("CANAL_DENUNCIA_ALERTA")
      .update({ resolvido_em: new Date().toISOString() }).eq("id", a.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["canal-denuncias-alertas"] });
  };

  return (
    <div>
      <PageHeader
        title="Denúncias"
        subtitle="Relatos recebidos pelo Canal de Ética. Conteúdo confidencial."
        module="Comitê de Ética"
        breadcrumb={["Comitê de Ética", "Denúncias"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/comite-etica/indicadores")}>
              <BarChart3 className="h-4 w-4" /> Indicadores
            </Button>
            <ExportarLista denuncias={filtradas} />
            <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/comite-etica/configuracao")}>
              <Settings2 className="h-4 w-4" /> Configuração
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={copiarLink}>
              {copiou ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
              {copiou ? "Link copiado" : "Copiar link da denúncia"}
            </Button>
          </div>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 border-info/30 bg-info/5 p-4">
        <ShieldAlert className="h-5 w-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-info">Link público para registrar denúncia</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{linkPublico}</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copiarLink}>
          <Copy className="h-3.5 w-3.5" /> Copiar
        </Button>
      </Card>

      {/* Os alertas que o tick diário acendeu. Ficam acima de tudo: é o que
          responde "o que precisa de mim hoje?" sem ninguém abrir filtro. */}
      {alertas.length > 0 && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <BellRing className="h-4 w-4" />
            {alertas.length === 1 ? "1 alerta em aberto" : `${alertas.length} alertas em aberto`}
          </p>
          <ul className="flex flex-col gap-1.5">
            {alertas.slice(0, 8).map((a) => {
              const alvoAlerta = denuncias.find((d) => d.id === a.denuncia_id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="shrink-0">{TIPO_ALERTA[a.tipo] ?? a.tipo}</Badge>
                  <button
                    type="button"
                    className="flex-1 text-left hover:underline disabled:cursor-default disabled:no-underline"
                    disabled={!alvoAlerta}
                    onClick={() => alvoAlerta && setAlvo(alvoAlerta)}
                  >
                    {a.mensagem}
                  </button>
                  <Button variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => darBaixa(a)} aria-label="Dar baixa no alerta">
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
          {alertas.length > 8 && (
            <p className="mt-2 text-xs text-muted-foreground">e mais {alertas.length - 8}…</p>
          )}
        </Card>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          { k: "todas", label: "Total recebidas", v: kpis.total, icon: Inbox, tone: "text-primary" },
          { k: "nova", label: "Aguardando triagem", v: kpis.novas, icon: ShieldAlert, tone: "text-info" },
          { k: "andamento", label: "Em apuração", v: kpis.andamento, icon: Search, tone: "text-warning" },
          { k: "vencidas", label: "Fora do prazo", v: kpis.vencidas, icon: TimerOff, tone: "text-destructive" },
          { k: "paradas", label: "Sem movimentação", v: kpis.paradas, icon: PauseCircle, tone: "text-warning" },
          { k: "risco", label: "Risco imediato", v: kpis.risco, icon: ShieldAlert, tone: "text-destructive" },
        ].map((s) => (
          <Card key={s.k} className="flex items-center gap-3 p-4">
            <s.icon className={`h-5 w-5 shrink-0 ${s.tone}`} />
            <div>
              <p className="text-2xl font-bold leading-none">{s.v}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9" placeholder="Buscar por protocolo, relato, pessoa, contrato ou setor…"
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as situações</SelectItem>
              {SITUACAO.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fGravidade} onValueChange={setFGravidade}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Toda gravidade</SelectItem>
              {GRAVIDADE.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fResultado} onValueChange={setFResultado}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo resultado</SelectItem>
              {RESULTADO.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fEmpresa} onValueChange={setFEmpresa}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as empresas</SelectItem>
              {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fContrato} onValueChange={setFContrato}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os contratos</SelectItem>
              {contratos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fResponsavel} onValueChange={setFResponsavel}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo responsável</SelectItem>
              <SelectItem value="__sem">Sem responsável</SelectItem>
              {responsaveis.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fPeriodo} onValueChange={setFPeriodo}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tudo">Todo o período</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 3 meses</SelectItem>
              <SelectItem value="180">Últimos 6 meses</SelectItem>
              <SelectItem value="365">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
          {/* Atalhos do que precisa de atenção. Cada um é um recorte que a
              dona do canal pediria de manhã, e que os selects não dão
              combinando: "fora do prazo" e "parado" são contas, não campos. */}
          <div className="flex gap-1.5">
            {([
              ["risco", "Risco imediato"],
              ["vencidas", "Fora do prazo"],
              ["paradas", "Paradas"],
            ] as const).map(([k, rot]) => (
              <Button
                key={k} size="sm" variant={fAtencao === k ? "default" : "outline"}
                onClick={() => setFAtencao(fAtencao === k ? "" : k)}
              >
                {rot}
              </Button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Assunto</TableHead>
                <TableHead>Recebida em</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Grav.</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Contrato / Setor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Parado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Carregando…
                </TableCell></TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  {denuncias.length === 0
                    ? "Nenhuma denúncia recebida ainda. Divulgue o link acima para o canal começar a receber."
                    : "Nenhuma denúncia com esse filtro."}
                </TableCell></TableRow>
              )}
              {filtradas.map((d) => {
                const restam = diasRestantes(d, slas);
                const parado = diasParado(d);
                return (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => setAlvo(d)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{d.protocolo}</TableCell>
                    <TableCell className="max-w-[200px] text-xs">
                      {d.titulo
                        ? <span className="block truncate font-medium">{d.titulo}</span>
                        : <span className="block truncate text-muted-foreground">{d.descricao}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(d.created_at)}</TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_TIPO, tipoEfetivo(d))}</TableCell>
                    <TableCell>
                      {d.gravidade
                        ? <Badge variant="outline" className="text-[10px] font-semibold"
                                 style={{ color: COR_GRAVIDADE[d.gravidade], borderColor: COR_GRAVIDADE[d.gravidade] }}>
                            {rotulo(LABEL_GRAVIDADE, d.gravidade)}
                          </Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {d.identificado
                          ? <><User className="h-3.5 w-3.5 text-muted-foreground" /> {d.nome_completo || "Identificado"}</>
                          : <><UserX className="h-3.5 w-3.5 text-muted-foreground" /> Anônima</>}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{rotulo(LABEL_RELACAO, d.relacao)}</span>
                    </TableCell>
                    <TableCell className="max-w-[170px] text-xs">
                      <span className="block truncate">{d.contrato || "—"}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{d.setor || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-semibold ${CLS_SITUACAO[d.status] ?? ""}`}>
                        {rotulo(LABEL_SITUACAO, d.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.resultado
                        ? <Badge variant="outline" className={`text-[10px] font-semibold ${CLS_RESULTADO[d.resultado] ?? ""}`}>
                            {rotulo(LABEL_RESULTADO, d.resultado)}
                          </Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {restam === null
                        ? <span className="text-muted-foreground">concluída</span>
                        : restam < 0
                          ? <span className="font-bold text-destructive">venceu há {Math.abs(restam)} d</span>
                          : <span className={restam <= 3 ? "font-semibold text-warning" : "text-muted-foreground"}>
                              {restam} d
                            </span>}
                    </TableCell>
                    {/* Parado é outra pergunta que o prazo não responde: um
                        caso dentro do prazo pode estar abandonado há semanas. */}
                    <TableCell className="whitespace-nowrap text-xs">
                      {parado === null
                        ? <span className="text-muted-foreground">—</span>
                        : <span className={parada(d, slas) ? "font-semibold text-warning" : "text-muted-foreground"}>
                            {parado} d
                          </span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {denuncias.length} denúncias. Clique numa linha para abrir a ficha de apuração.
        </p>
      </Card>

      <FichaDenuncia
        denuncia={alvo}
        slas={slas}
        todas={denuncias}
        onFechar={() => setAlvo(null)}
        onSalvo={() => { qc.invalidateQueries({ queryKey: ["canal-denuncias"] }); setAlvo(null); }}
      />
    </div>
  );
}
