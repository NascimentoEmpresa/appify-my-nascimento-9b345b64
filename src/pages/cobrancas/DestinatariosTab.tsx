import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Mail, MailCheck, MailX, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiTile } from "@/components/financeiro/KpiTile";
import ImportarEmailsContratoCard from "@/pages/financeiro/receber/ImportarEmailsContratoCard";
import { emailValido, lerEmails, semDuplicados } from "./regrasModelosEmails";

// SIS-2026-0653: quem recebe a cobrança de cada contrato (tabela contrato_email_cobranca). Sem e-mail cadastrado o contrato fica
// em "Cadastrar e-mail do tomador" na Automação e nada é enviado. A rotina lê esta tabela a cada envio: o que for salvo vale no próximo.

interface ContratoLinha {
  id: string;
  nome: string;
  status: string;
  empresa_id: string | null;
}
interface EmailLinha {
  id: string;
  contrato_id: string;
  email: string;
}

async function lerTudo<T>(tabela: string, colunas: string, ordem: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await (supabase as any).from(tabela).select(colunas).order(ordem).range(de, de + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function DestinatariosTab() {
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", undefined, "cobrancas");
  const podeMarcarManual = podeAlterar || can("aprovar", undefined, "cobrancas");
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [empresa, setEmpresa] = useState("todas");
  const [soSemEmail, setSoSemEmail] = useState(false);
  const [comEncerrados, setComEncerrados] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const { data: contratos = [], isLoading } = useQuery<ContratoLinha[]>({
    queryKey: ["cobranca-dest-contratos"],
    queryFn: () => lerTudo<ContratoLinha>("contratos", "id, nome, status, empresa_id", "nome"),
  });
  const { data: emails = [] } = useQuery<EmailLinha[]>({
    queryKey: ["cobranca-dest-emails"],
    queryFn: () => lerTudo<EmailLinha>("contrato_email_cobranca", "id, contrato_id, email", "id"),
  });
  const { data: manuais = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["cobranca-dest-manuais"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("cobranca_auto_contrato_manual").select("contrato_id");
      return new Set<string>((data ?? []).map((r: any) => r.contrato_id));
    },
  });
  const { data: empresas = [] } = useQuery<{ id: string; codigo: string }[]>({
    queryKey: ["cobranca-dest-empresas"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("empresas").select("id, codigo").order("codigo");
      return data ?? [];
    },
  });

  const codigoEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.codigo])), [empresas]);
  const emailsPorContrato = useMemo(() => {
    const m = new Map<string, EmailLinha[]>();
    for (const e of emails) m.set(e.contrato_id, [...(m.get(e.contrato_id) ?? []), e]);
    return m;
  }, [emails]);

  const ativos = useMemo(() => contratos.filter((c) => c.status === "ativo"), [contratos]);
  const semEmailAtivos = ativos.filter((c) => !emailsPorContrato.has(c.id)).length;

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contratos.filter((c) => {
      if (!comEncerrados && c.status !== "ativo") return false;
      if (empresa !== "todas" && c.empresa_id !== empresa) return false;
      if (soSemEmail && emailsPorContrato.has(c.id)) return false;
      if (!termo) return true;
      return (
        c.nome.toLowerCase().includes(termo) ||
        (emailsPorContrato.get(c.id) ?? []).some((e) => e.email.toLowerCase().includes(termo))
      );
    });
  }, [contratos, busca, empresa, soSemEmail, comEncerrados, emailsPorContrato]);

  const aberto = contratos.find((c) => c.id === abertoId) ?? null;

  const atualizou = () => {
    qc.invalidateQueries({ queryKey: ["cobranca-dest-emails"] });
    qc.invalidateQueries({ queryKey: ["cobranca-auto-simulacao"] });
  };

  const adicionar = useMutation({
    mutationFn: async ({ contratoId, texto }: { contratoId: string; texto: string }) => {
      const { validos, invalidos } = lerEmails(texto);
      if (invalidos.length) throw new Error(`E-mail inválido: ${invalidos.join(", ")}`);
      if (validos.length === 0) throw new Error("Informe ao menos um e-mail.");
      const { adicionar: novos, jaExistiam } = semDuplicados(validos, (emailsPorContrato.get(contratoId) ?? []).map((e) => e.email));
      if (novos.length === 0) throw new Error("Esse e-mail já está cadastrado neste contrato.");
      const { error } = await (supabase as any).from("contrato_email_cobranca").insert(novos.map((email) => ({ contrato_id: contratoId, email })));
      if (error) throw error;
      return { novos: novos.length, jaExistiam: jaExistiam.length };
    },
    onSuccess: (r) => {
      atualizou();
      toast.success(`${r.novos} e-mail(s) adicionado(s)${r.jaExistiam ? `; ${r.jaExistiam} já estavam cadastrados` : ""}.`);
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const editar = useMutation({
    mutationFn: async ({ id, contratoId, email }: { id: string; contratoId: string; email: string }) => {
      const novo = email.trim();
      if (!emailValido(novo)) throw new Error("E-mail inválido.");
      const outros = (emailsPorContrato.get(contratoId) ?? []).filter((e) => e.id !== id).map((e) => e.email);
      if (semDuplicados([novo], outros).jaExistiam.length) throw new Error("Esse e-mail já está cadastrado neste contrato.");
      const { error } = await (supabase as any).from("contrato_email_cobranca").update({ email: novo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      atualizou();
      toast.success("E-mail atualizado.");
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("contrato_email_cobranca").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      atualizou();
      toast.success("E-mail removido.");
    },
    onError: (e: any) => toast.error(`Não foi possível remover: ${e.message ?? e}`),
  });

  const alternarManual = useMutation({
    mutationFn: async ({ contratoId, manual }: { contratoId: string; manual: boolean }) => {
      const t = (supabase as any).from("cobranca_auto_contrato_manual");
      const { error } = manual ? await t.upsert({ contrato_id: contratoId, motivo: "Marcado na tela de Cobranças" }) : await t.delete().eq("contrato_id", contratoId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cobranca-dest-manuais"] });
      qc.invalidateQueries({ queryKey: ["cobranca-auto-simulacao"] });
    },
    onError: (e: any) => toast.error(`Não foi possível alterar: ${e.message ?? e}`),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Contratos ativos" valor={String(ativos.length)} icon={<Mail />} cor="slate" />
        <KpiTile label="Com e-mail cadastrado" valor={String(ativos.length - semEmailAtivos)} icon={<MailCheck />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
        <KpiTile label="Sem e-mail" sub="não recebem cobrança" valor={String(semEmailAtivos)} icon={<MailX />} cor="red" valorClass="text-red-600 dark:text-red-400" onClick={() => setSoSemEmail(true)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-72" placeholder="Buscar contrato ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select value={empresa} onValueChange={setEmpresa}>
          <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.codigo}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={soSemEmail} onCheckedChange={setSoSemEmail} /> Só sem e-mail</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={comEncerrados} onCheckedChange={setComEncerrados} /> Incluir encerrados</label>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>E-mails do tomador</TableHead>
                <TableHead className="w-28">Envio</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && linhas.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum contrato encontrado.</TableCell></TableRow>}
              {linhas.map((c) => {
                const lista = emailsPorContrato.get(c.id) ?? [];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.nome}
                      {c.status !== "ativo" && <Badge variant="outline" className="ml-2 text-[10px]">{c.status}</Badge>}
                    </TableCell>
                    <TableCell>{c.empresa_id ? codigoEmpresa.get(c.empresa_id) ?? "—" : "—"}</TableCell>
                    <TableCell className="text-sm">
                      {lista.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-destructive"><MailX className="h-3.5 w-3.5" /> sem e-mail</span>
                      ) : (
                        lista.map((e) => e.email).join("; ")
                      )}
                    </TableCell>
                    <TableCell>{manuais.has(c.id) ? <Badge variant="outline">Só manual</Badge> : <span className="text-xs text-muted-foreground">Automático</span>}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setAbertoId(c.id)}>
                        <Pencil className="h-3.5 w-3.5" /> {podeAlterar ? "Editar" : "Ver"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {podeAlterar && <ImportarEmailsContratoCard />}

      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAbertoId(null)}>
        <DialogContent className="max-w-xl">
          {aberto && (
            <EditorContrato
              contrato={aberto}
              emails={emailsPorContrato.get(aberto.id) ?? []}
              manual={manuais.has(aberto.id)}
              podeAlterar={podeAlterar}
              podeMarcarManual={podeMarcarManual}
              ocupado={adicionar.isPending || editar.isPending || remover.isPending || alternarManual.isPending}
              onAdicionar={(texto) => adicionar.mutateAsync({ contratoId: aberto.id, texto })}
              onEditar={(id, email) => editar.mutateAsync({ id, contratoId: aberto.id, email })}
              onRemover={(id) => remover.mutate(id)}
              onManual={(manual) => alternarManual.mutate({ contratoId: aberto.id, manual })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorContrato({
  contrato, emails, manual, podeAlterar, podeMarcarManual, ocupado, onAdicionar, onEditar, onRemover, onManual,
}: {
  contrato: ContratoLinha;
  emails: EmailLinha[];
  manual: boolean;
  podeAlterar: boolean;
  podeMarcarManual: boolean;
  ocupado: boolean;
  onAdicionar: (texto: string) => Promise<unknown>;
  onEditar: (id: string, email: string) => Promise<unknown>;
  onRemover: (id: string) => void;
  onManual: (manual: boolean) => void;
}) {
  const [novo, setNovo] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  return (
    <>
      <DialogHeader>
        <DialogTitle>{contrato.nome}</DialogTitle>
        <DialogDescription>E-mails que recebem a cobrança deste contrato. Pode colar vários de uma vez, separados por ponto e vírgula ou espaço.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        {emails.length === 0 && <p className="text-sm text-destructive">Nenhum e-mail cadastrado: este contrato não recebe cobrança.</p>}
        {emails.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            {editandoId === e.id ? (
              <>
                <Input className="h-8" value={rascunho} onChange={(ev) => setRascunho(ev.target.value)} autoFocus />
                <Button
                  size="icon" variant="outline" className="h-8 w-8" disabled={ocupado}
                  onClick={async () => {
                    try {
                      await onEditar(e.id, rascunho);
                      setEditandoId(null);
                    } catch { /* o aviso já foi mostrado */ }
                  }}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditandoId(null)}><X className="h-4 w-4" /></Button>
              </>
            ) : (
              <>
                <span className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm">{e.email}</span>
                {podeAlterar && (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditandoId(e.id); setRascunho(e.email); }}><Pencil className="h-4 w-4" /></Button>
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={ocupado}
                      onClick={() => { if (window.confirm(`Remover ${e.email} deste contrato?`)) onRemover(e.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {podeAlterar && (
        <div className="flex gap-2">
          <Input placeholder="novo@orgao.gov.br; outro@orgao.gov.br" value={novo} onChange={(e) => setNovo(e.target.value)} />
          <Button
            className="gap-1" disabled={ocupado || !novo.trim()}
            onClick={async () => {
              try {
                await onAdicionar(novo);
                setNovo("");
              } catch { /* o aviso já foi mostrado */ }
            }}
          >
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      )}

      {podeMarcarManual && (
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label>Cobrança só manual</Label>
            <p className="text-xs text-muted-foreground">Ligado: a rotina nunca envia para este contrato; o Financeiro ou o Jurídico cobra à mão.</p>
          </div>
          <Switch checked={manual} disabled={ocupado} onCheckedChange={onManual} />
        </div>
      )}
    </>
  );
}
