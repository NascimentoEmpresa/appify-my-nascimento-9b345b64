import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BUCKET, TABELA, TABELA_ANEXOS, corDoStatus, explicaStatus, fmtData, fmtDataHora,
  fmtTamanho, type AnexoDemissao, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import {
  CheckCircle2, Clock, Download, FileText, Loader2, Search, ThumbsDown, ThumbsUp, XCircle,
} from "lucide-react";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Painel das solicitações de demissão — a mesma tela para as duas etapas.
 *
 *   operacional → aprova (segue para o RH) ou reprova COM MOTIVO;
 *   rh          → conclui o que o operacional já aprovou.
 *
 * Um componente só porque a lista, os filtros, o detalhe e os anexos são
 * idênticos: o que muda é quem pode agir e sobre qual status. Duas cópias
 * divergiriam na primeira correção feita em uma delas.
 *
 * O RH não enxerga o que ainda está com o operacional nem o que foi
 * reprovado: para o RH, a solicitação só existe depois de aprovada.
 */

export type Etapa = "operacional" | "rh";

/** Os status que cada etapa enxerga, na ordem em que fazem sentido na fila. */
const STATUS_DA_ETAPA: Record<Etapa, string[]> = {
  operacional: ["Pendente Operacional", "Pendente RH", "Concluída", "Reprovada", "Cancelada"],
  rh: ["Pendente RH", "Concluída"],
};

/** O status em que a etapa TEM trabalho a fazer. */
const STATUS_DE_ACAO: Record<Etapa, string> = {
  operacional: "Pendente Operacional",
  rh: "Pendente RH",
};

function Kpi({ titulo, valor, icone: Icone, cor }: {
  titulo: string; valor: number; icone: any; cor: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", cor)}>
          <Icone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PainelDemissoes({ etapa }: { etapa: Etapa }) {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<SolicitacaoDemissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [aberta, setAberta] = useState<SolicitacaoDemissao | null>(null);

  const statusVisiveis = STATUS_DA_ETAPA[etapa];
  const statusDeAcao = STATUS_DE_ACAO[etapa];

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await sb.from(TABELA)
      .select("*").in("status", statusVisiveis)
      .order("criado_em", { ascending: false }).limit(500);
    if (error) toast.error("Erro ao carregar as solicitações: " + error.message);
    setLinhas(data ?? []);
    setCarregando(false);
  };
  useEffect(() => { carregar(); }, [etapa]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((s) => {
      if (fStatus && s.status !== fStatus) return false;
      if (!q) return true;
      return [s.colaborador_nome, s.solicitante_nome, s.contrato, s.colaborador_posto, String(s.id)]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, fStatus]);

  const contar = (status: string) => linhas.filter((s) => s.status === status).length;

  // Quem decidiu: o nome que fica gravado na solicitação.
  const [quemSou, setQuemSou] = useState("");
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle();
      setQuemSou(data?.display_name ?? data?.email ?? user.email ?? "");
    })();
  }, [user?.id, user?.email]);

  const decidir = async (s: SolicitacaoDemissao, patch: Record<string, any>, aviso: string) => {
    const { error } = await sb.from(TABELA)
      .update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", s.id);
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    toast.success(aviso);
    setAberta(null);
    carregar();
    return true;
  };

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {etapa === "operacional" ? (
          <>
            <Kpi titulo="Aguardando você" valor={contar("Pendente Operacional")} icone={Clock} cor="bg-yellow-100 text-yellow-700" />
            <Kpi titulo="No RH" valor={contar("Pendente RH")} icone={FileText} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="Concluídas" valor={contar("Concluída")} icone={CheckCircle2} cor="bg-green-100 text-green-700" />
            <Kpi titulo="Reprovadas" valor={contar("Reprovada")} icone={XCircle} cor="bg-red-100 text-red-700" />
          </>
        ) : (
          <>
            <Kpi titulo="Aguardando o RH" valor={contar("Pendente RH")} icone={Clock} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="Concluídas" valor={contar("Concluída")} icone={CheckCircle2} cor="bg-green-100 text-green-700" />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Solicitações</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="w-56 pl-8" placeholder="Colaborador, solicitante, contrato…"
                value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={fStatus || "todos"} onValueChange={(v) => setFStatus(v === "todos" ? "" : v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Todos os status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {statusVisiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={carregar} disabled={carregando}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {linhas.length === 0
                ? "Nenhuma solicitação de demissão por aqui ainda."
                : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="hidden md:table-cell">Contrato</TableHead>
                    <TableHead className="hidden lg:table-cell">Solicitante</TableHead>
                    <TableHead className="hidden sm:table-cell">Aberta em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setAberta(s)}>
                      <TableCell className="text-muted-foreground">{s.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">{s.colaborador_nome}</div>
                        <div className="text-xs text-muted-foreground">{s.colaborador_posto || "—"}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{s.contrato || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{s.solicitante_nome || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">{fmtData(s.criado_em)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={corDoStatus(s.status)}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setAberta(s); }}>
                          {s.status === statusDeAcao ? "Analisar" : "Ver"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetalheSolicitacao
        solicitacao={aberta} etapa={etapa} quemSou={quemSou}
        onFechar={() => setAberta(null)} onDecidir={decidir}
      />
    </>
  );
}

// ── Detalhe + decisão ────────────────────────────────────────────────
function DetalheSolicitacao({ solicitacao, etapa, quemSou, onFechar, onDecidir }: {
  solicitacao: SolicitacaoDemissao | null;
  etapa: Etapa;
  quemSou: string;
  onFechar: () => void;
  onDecidir: (s: SolicitacaoDemissao, patch: Record<string, any>, aviso: string) => Promise<boolean>;
}) {
  const [anexos, setAnexos] = useState<AnexoDemissao[]>([]);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setMotivo(""); setObservacao(""); setAnexos([]);
    if (!solicitacao) return;
    (async () => {
      const { data } = await sb.from(TABELA_ANEXOS)
        .select("*").eq("solicitacao_id", solicitacao.id).order("id");
      setAnexos(data ?? []);
    })();
  }, [solicitacao?.id]);

  if (!solicitacao) return null;
  const s = solicitacao;
  const podeAgir = s.status === STATUS_DE_ACAO[etapa];

  // O bucket é privado: o documento abre por URL assinada, válida por 1 hora.
  const abrirAnexo = async (a: AnexoDemissao) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Não consegui abrir o documento."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const aprovar = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: "Pendente RH", operacional_por: quemSou,
      operacional_em: new Date().toISOString(), operacional_motivo: null,
    }, `Solicitação #${s.id} aprovada e enviada ao RH.`);
    setSalvando(false);
  };

  const reprovar = async () => {
    // Reprovar sem motivo devolve o encarregado ao ponto de partida sem saber
    // o que corrigir — por isso o motivo é obrigatório aqui, não opcional.
    if (motivo.trim().length < 10) { toast.error("Escreva o motivo da reprovação (mín. 10 caracteres)."); return; }
    setSalvando(true);
    await onDecidir(s, {
      status: "Reprovada", operacional_por: quemSou,
      operacional_em: new Date().toISOString(), operacional_motivo: motivo.trim(),
    }, `Solicitação #${s.id} reprovada.`);
    setSalvando(false);
  };

  const concluir = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: "Concluída", rh_por: quemSou,
      rh_em: new Date().toISOString(), rh_observacao: observacao.trim() || null,
    }, `Solicitação #${s.id} concluída.`);
    setSalvando(false);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Solicitação #{s.id} · {s.colaborador_nome}
            <Badge variant="outline" className={corDoStatus(s.status)}>{s.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{explicaStatus(s.status)}</p>

        <Secao titulo="Colaborador" itens={[
          ["Nome", s.colaborador_nome], ["CPF", s.colaborador_cpf],
          ["Posto", s.colaborador_posto], ["Cargo", s.colaborador_cargo],
          ["Contrato", s.contrato], ["Escala", s.escala],
          ["Admissão", fmtData(s.colaborador_admissao)],
          ["Telefone", s.colaborador_telefone], ["E-mail", s.colaborador_email],
        ]} />

        <Secao titulo="Solicitação" itens={[
          ["Solicitante", s.solicitante_nome], ["E-mail do solicitante", s.solicitante_email],
          ["Data da solicitação", fmtData(s.data_solicitacao)],
          ["Motivo da solicitação", s.motivo_solicitacao], ["Motivo do pedido", s.motivo_pedido],
        ]} />

        <div className="rounded-lg border p-4">
          <h3 className="mb-1 text-sm font-semibold">Relato do encarregado</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.relato || "—"}</p>
        </div>

        <Secao titulo="Aviso" itens={[
          ["Término de experiência", s.termino_experiencia],
          ["Data do aviso", fmtData(s.data_aviso)],
          ["Modelo de aviso", s.modelo_aviso],
        ]} />

        <div className="rounded-lg border p-4">
          <h3 className="mb-2 text-sm font-semibold">Documentos ({anexos.length})</h3>
          {anexos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
          ) : (
            <ul className="space-y-2">
              {anexos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">{fmtTamanho(a.tamanho)}</span>
                  <Button variant="ghost" size="sm" onClick={() => abrirAnexo(a)}>
                    <Download className="mr-1 h-4 w-4" /> Abrir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Histórico das decisões já tomadas */}
        {(s.operacional_em || s.rh_em) && (
          <Secao titulo="Decisões" itens={[
            ["Operacional", s.operacional_por ? `${s.operacional_por} · ${fmtDataHora(s.operacional_em)}` : "—"],
            ["Motivo da reprovação", s.operacional_motivo],
            ["RH", s.rh_por ? `${s.rh_por} · ${fmtDataHora(s.rh_em)}` : "—"],
            ["Observação do RH", s.rh_observacao],
          ]} />
        )}

        {/* Ações da etapa */}
        {podeAgir && etapa === "operacional" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Sua decisão</h3>
            <div>
              <Label htmlFor="motivo">Motivo da reprovação</Label>
              <Textarea id="motivo" className="mt-1" placeholder="Obrigatório só para reprovar — explique o que precisa ser corrigido."
                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={aprovar} disabled={salvando}>
                <ThumbsUp className="mr-2 h-4 w-4" /> Aprovar e enviar ao RH
              </Button>
              <Button variant="destructive" onClick={reprovar} disabled={salvando}>
                <ThumbsDown className="mr-2 h-4 w-4" /> Reprovar
              </Button>
            </div>
          </div>
        )}

        {podeAgir && etapa === "rh" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Concluir no RH</h3>
            <div>
              <Label htmlFor="obs">Observação (opcional)</Label>
              <Textarea id="obs" className="mt-1" placeholder="O que foi feito, datas do acerto, pendências…"
                value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
            <Button onClick={concluir} disabled={salvando}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Concluir solicitação
            </Button>
          </div>
        )}

        {/* Quem pediu a demissão escreve do lado dele, em Minhas Solicitações.
            É o mesmo fio — sem este bloco, o encarregado perguntava e nem o
            Operacional nem o RH viam. */}
        <ConversaSolicitacao
          modulo="demissao" entidadeId={s.id}
          aviso="Quem solicitou lê e responde por Encarregados › Minhas Solicitações. Operacional e RH veem a mesma conversa."
        />
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, itens }: { titulo: string; itens: [string, string | null | undefined][] }) {
  const preenchidos = itens.filter(([, v]) => v);
  if (!preenchidos.length) return null;
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {preenchidos.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
