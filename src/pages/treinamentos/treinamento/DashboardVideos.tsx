import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart3, CheckCircle2, Download, Eye, Loader2, PlayCircle, Search, TrendingUp, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ESCOPOS_TREINAMENTO, resumirDashboard, type EscopoTreinamento } from "./core";

// =====================================================================
// TREINAMENTOS — Dashboard de vídeos: quem viu, quem concluiu, quantas vezes.
//
// Duas perguntas diferentes, duas abas: "Por vídeo" responde quanto cada
// treinamento rendeu; "Por pessoa" responde o que fulano assistiu. A mesma
// tabela achatada serviria mal às duas — quem procura um vídeo não quer rolar
// 200 linhas de gente, e quem procura uma pessoa não quer somar colunas.
//
// Os números vêm agregados do banco (`trn_dashboard_videos` /
// `trn_dashboard_pessoas`), não de um SELECT cru somado aqui: as duas RPCs
// também são o gate real — quem não tem o menu `treinamentos_dashboard` toma
// exceção delas, mesmo que force a abertura deste componente.
//
// ⚠ "Quem NÃO viu" não é uma coluna daqui, e a ausência é deliberada: o
// módulo não tem público-alvo cadastrado (não existe "este treinamento é
// obrigatório para o setor X"), então a única lista honesta de faltantes
// seria "todo mundo do ERP menos estes", o que não é a pergunta de ninguém.
// Se um dia treinamento ganhar público-alvo, é aqui que a coluna entra.
// =====================================================================

interface LinhaVideo {
  treinamento_id: string;
  titulo: string;
  escopos: EscopoTreinamento[];
  publicado: boolean;
  tem_video: boolean;
  tem_prova: boolean;
  pessoas_viram: number;
  visualizacoes: number;
  conclusoes: number;
  aprovados: number;
  nota_media: number | null;
  ultima_atividade: string | null;
}

interface LinhaPessoa {
  treinamento_id: string;
  titulo: string;
  user_id: string;
  usuario_nome: string;
  visualizou: boolean;
  aberturas: number;
  primeira_em: string | null;
  ultima_em: string | null;
  concluiu: boolean;
  prova_nota: number | null;
  aprovado: boolean | null;
  concluido_em: string | null;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** De qual porta o dashboard foi aberto — vira o filtro inicial. */
  escopo: EscopoTreinamento;
}

const TODOS = "__todos__";

const dataHora = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function DashboardVideos({ aberto, onFechar, escopo }: Props) {
  const { toast } = useToast();
  const [videos, setVideos] = useState<LinhaVideo[]>([]);
  const [pessoas, setPessoas] = useState<LinhaPessoa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroEscopo, setFiltroEscopo] = useState<string>(escopo);
  const [filtroVideo, setFiltroVideo] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("videos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const escopoParam = filtroEscopo === TODOS ? null : filtroEscopo;
    // As duas em paralelo: são independentes e serializar dobraria a espera
    // de abertura do painel à toa.
    const [v, p] = await Promise.all([
      (supabase as any).rpc("trn_dashboard_videos", { _escopo: escopoParam }),
      (supabase as any).rpc("trn_dashboard_pessoas", {
        _treinamento: filtroVideo === TODOS ? null : filtroVideo,
        _escopo: escopoParam,
      }),
    ]);
    setCarregando(false);
    if (v.error || p.error) {
      toast({
        title: "Não deu para carregar o dashboard",
        description: (v.error ?? p.error)?.message,
        variant: "destructive",
      });
      return;
    }
    setVideos((v.data ?? []) as LinhaVideo[]);
    setPessoas((p.data ?? []) as LinhaPessoa[]);
  }, [filtroEscopo, filtroVideo, toast]);

  useEffect(() => { if (aberto) carregar(); }, [aberto, carregar]);

  // O filtro de vídeo já foi aplicado no banco para `pessoas`; aqui ele
  // recorta a tabela de vídeos, que vem sempre inteira (é ela que alimenta o
  // próprio combo de seleção).
  const videosVisiveis = useMemo(
    () => (filtroVideo === TODOS ? videos : videos.filter((v) => v.treinamento_id === filtroVideo)),
    [videos, filtroVideo],
  );

  const pessoasVisiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas;
    return pessoas.filter((p) => p.usuario_nome.toLowerCase().includes(q) || p.titulo.toLowerCase().includes(q));
  }, [pessoas, busca]);

  const total = useMemo(() => resumirDashboard(videosVisiveis, pessoas), [videosVisiveis, pessoas]);

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        videosVisiveis.map((v) => ({
          Treinamento: v.titulo,
          Módulos: v.escopos.map((e) => ESCOPOS_TREINAMENTO.find((x) => x.id === e)?.label ?? e).join(", "),
          Publicado: v.publicado ? "Sim" : "Não",
          "Tem vídeo": v.tem_video ? "Sim" : "Não",
          "Pessoas que viram": v.pessoas_viram,
          Visualizações: v.visualizacoes,
          Conclusões: v.conclusoes,
          Aprovados: v.aprovados,
          "Nota média": v.nota_media ?? "",
          "Última atividade": dataHora(v.ultima_atividade),
        })),
      ),
      "Por vídeo",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        pessoasVisiveis.map((p) => ({
          Pessoa: p.usuario_nome,
          Treinamento: p.titulo,
          Assistiu: p.visualizou ? "Sim" : "Não",
          Visualizações: p.aberturas,
          "Primeira vez": dataHora(p.primeira_em),
          "Última vez": dataHora(p.ultima_em),
          Concluiu: p.concluiu ? "Sim" : "Não",
          Nota: p.prova_nota ?? "",
          Aprovado: p.aprovado == null ? "" : p.aprovado ? "Sim" : "Não",
          "Concluído em": dataHora(p.concluido_em),
        })),
      ),
      "Por pessoa",
    );
    XLSX.writeFile(wb, `treinamentos_dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <BarChart3 className="h-5 w-5 text-primary" /> Dashboard de vídeos
          </DialogTitle>
          <DialogDescription>
            Quem assistiu, quantas vezes e quem marcou como concluído. Uma visualização
            é contada cada vez que a pessoa abre o treinamento.
          </DialogDescription>
        </DialogHeader>

        {/* ---- filtros ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroVideo} onValueChange={setFiltroVideo}>
            <SelectTrigger className="w-[280px]">
              <PlayCircle className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os vídeos</SelectItem>
              {videos.map((v) => (
                <SelectItem key={v.treinamento_id} value={v.treinamento_id}>{v.titulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroEscopo} onValueChange={setFiltroEscopo}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os módulos</SelectItem>
              {ESCOPOS_TREINAMENTO.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa ou treinamento…"
              className="pl-8"
            />
          </div>

          <Button variant="outline" onClick={exportar} disabled={carregando}>
            <Download className="mr-1.5 h-4 w-4" /> Excel
          </Button>
        </div>

        {/* ---- indicadores ---- */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Indicador icone={Eye} label="Visualizações" valor={total.visualizacoes} tom="primary" />
          <Indicador icone={Users} label="Pessoas que viram" valor={total.distintas} tom="sky" />
          <Indicador icone={CheckCircle2} label="Conclusões" valor={total.conclusoes} tom="emerald" />
          <Indicador icone={TrendingUp} label="Taxa de conclusão" valor={`${total.taxa}%`} tom="violet" />
          <Indicador icone={CheckCircle2} label="Aprovados na prova" valor={total.aprovados} tom="amber" />
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando os números…
          </div>
        ) : (
          <Tabs value={aba} onValueChange={setAba}>
            <TabsList>
              <TabsTrigger value="videos">Por vídeo ({videosVisiveis.length})</TabsTrigger>
              <TabsTrigger value="pessoas">Por pessoa ({pessoasVisiveis.length})</TabsTrigger>
            </TabsList>

            {/* ---- por vídeo ---- */}
            <TabsContent value="videos" className="mt-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Treinamento</TableHead>
                      <TableHead className="text-right">Visualizações</TableHead>
                      <TableHead className="text-right">Pessoas</TableHead>
                      <TableHead className="text-right">Concluíram</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                      <TableHead className="text-right">Nota média</TableHead>
                      <TableHead>Última atividade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {videosVisiveis.map((v) => {
                      const taxa = v.pessoas_viram > 0
                        ? Math.round((Number(v.conclusoes) / Number(v.pessoas_viram)) * 100)
                        : 0;
                      return (
                        <TableRow
                          key={v.treinamento_id}
                          className="cursor-pointer"
                          onClick={() => { setFiltroVideo(v.treinamento_id); setAba("pessoas"); }}
                        >
                          <TableCell>
                            <p className="font-medium">{v.titulo}</p>
                            <span className="flex flex-wrap items-center gap-1 pt-0.5">
                              {v.escopos.map((e) => (
                                <Badge key={e} variant="secondary" className="text-[10px]">
                                  {ESCOPOS_TREINAMENTO.find((x) => x.id === e)?.label ?? e}
                                </Badge>
                              ))}
                              {!v.publicado && <Badge variant="outline" className="text-[10px]">rascunho</Badge>}
                              {!v.tem_video && <Badge variant="outline" className="text-[10px]">sem vídeo</Badge>}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{v.visualizacoes}</TableCell>
                          <TableCell className="text-right tabular-nums">{v.pessoas_viram}</TableCell>
                          <TableCell className="text-right tabular-nums">{v.conclusoes}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                              taxa >= 80 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : taxa >= 40 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-muted text-muted-foreground",
                            )}>
                              {taxa}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {v.tem_prova ? (v.nota_media ?? "—") : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {dataHora(v.ultima_atividade)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {videosVisiveis.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">
                          Nenhum treinamento nesse filtro.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="pt-2 text-[11px] text-muted-foreground">
                Clique numa linha para ver quem assistiu aquele vídeo.
              </p>
            </TabsContent>

            {/* ---- por pessoa ---- */}
            <TabsContent value="pessoas" className="mt-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pessoa</TableHead>
                      <TableHead>Treinamento</TableHead>
                      <TableHead className="text-right">Vezes</TableHead>
                      <TableHead>Última vez</TableHead>
                      <TableHead>Concluiu</TableHead>
                      <TableHead className="text-right">Nota</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pessoasVisiveis.map((p) => (
                      <TableRow key={`${p.treinamento_id}-${p.user_id}`}>
                        <TableCell className="font-medium">{p.usuario_nome}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.titulo}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.visualizou ? p.aberturas : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{dataHora(p.ultima_em)}</TableCell>
                        <TableCell>
                          {p.concluiu ? (
                            <span className="flex items-center gap-1.5 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              <span className="text-xs text-muted-foreground">{dataHora(p.concluido_em)}</span>
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">só assistiu</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.prova_nota == null ? (
                            "—"
                          ) : (
                            <span className={cn(
                              "font-semibold",
                              p.aprovado ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                            )}>
                              {p.prova_nota}%
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {pessoasVisiveis.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">
                          {busca ? "Ninguém com esse termo." : "Ninguém abriu esse treinamento ainda."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Indicador({
  icone: Icone,
  label,
  valor,
  tom,
}: {
  icone: typeof Eye;
  label: string;
  valor: number | string;
  tom: "primary" | "sky" | "emerald" | "violet" | "amber";
}) {
  const tons = {
    primary: "bg-primary/10 text-primary",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border p-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tons[tom]}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold leading-tight tabular-nums">{valor}</p>
      </div>
    </div>
  );
}
