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
} from "lucide-react";
import {
  SITUACAO, GRAVIDADE, RESULTADO, LABEL_SITUACAO, LABEL_TIPO, LABEL_RELACAO,
  LABEL_GRAVIDADE, LABEL_RESULTADO, COR_GRAVIDADE, rotulo,
} from "./vocabulario";
import {
  type Denuncia, type RegraSla, concluida, diasRestantes, tipoEfetivo, vencida,
} from "./metricas";
import FichaDenuncia from "./FichaDenuncia";

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

const CLS_SITUACAO: Record<string, string> = {
  nova: "border-info/30 bg-info/10 text-info",
  em_analise: "border-warning/30 bg-warning/10 text-warning",
  aguardando_documentos: "border-warning/30 bg-warning/10 text-warning",
  investigacao: "border-warning/30 bg-warning/10 text-warning",
  julgada: "border-primary/30 bg-primary/10 text-primary",
  encerrada: "border-border bg-muted text-muted-foreground",
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
  const [alvo, setAlvo] = useState<Denuncia | null>(null);
  const [copiou, setCopiou] = useState(false);

  const { data: denuncias = [], isLoading } = useQuery({
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

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return denuncias.filter((d) => {
      if (fStatus !== "todos" && d.status !== fStatus) return false;
      if (fGravidade !== "todas" && (d.gravidade ?? "") !== fGravidade) return false;
      if (fResultado !== "todos" && (d.resultado ?? "") !== fResultado) return false;
      if (!t) return true;
      return [d.protocolo, d.titulo, d.descricao, d.local_ocorrencia, d.nome_completo,
              d.denunciado_nome, d.lider_nome, d.contrato, d.setor, d.cidade]
        .some((c) => (c ?? "").toString().toLowerCase().includes(t));
    });
  }, [denuncias, busca, fStatus, fGravidade, fResultado]);

  const kpis = useMemo(() => {
    const abertas = denuncias.filter((d) => !concluida(d));
    return {
      total: denuncias.length,
      novas: denuncias.filter((d) => d.status === "nova").length,
      andamento: abertas.filter((d) => d.status !== "nova").length,
      vencidas: abertas.filter((d) => vencida(d, slas)).length,
    };
  }, [denuncias, slas]);

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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "todas", label: "Total recebidas", v: kpis.total, icon: Inbox, tone: "text-primary" },
          { k: "nova", label: "Aguardando triagem", v: kpis.novas, icon: ShieldAlert, tone: "text-info" },
          { k: "andamento", label: "Em apuração", v: kpis.andamento, icon: Search, tone: "text-warning" },
          { k: "vencidas", label: "Fora do prazo", v: kpis.vencidas, icon: TimerOff, tone: "text-destructive" },
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  Carregando…
                </TableCell></TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  {denuncias.length === 0
                    ? "Nenhuma denúncia recebida ainda. Divulgue o link acima para o canal começar a receber."
                    : "Nenhuma denúncia com esse filtro."}
                </TableCell></TableRow>
              )}
              {filtradas.map((d) => {
                const restam = diasRestantes(d, slas);
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
