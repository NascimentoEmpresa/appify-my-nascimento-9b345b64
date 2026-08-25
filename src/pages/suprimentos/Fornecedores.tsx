import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Package, Search, Building2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { MateriaisFornecedorDialog } from "@/components/suprimentos/MateriaisFornecedorDialog";
import { FORMAS_PAGAMENTO } from "@/hooks/useFornecedorCadastro";

/**
 * Fornecedores — recorte de Compras/Suprimentos.
 *
 * De propósito só o que Compras usa no dia a dia: quem é, como falar com ele
 * e o que ele fornece. A tabela public.fornecedor tem muito mais coluna
 * (sócios, PIX, endereço detalhado, CNAE, inscrição estadual, contas
 * bancárias) porque o Financeiro também consome esse cadastro em títulos a
 * pagar — os campos continuam lá e podem ganhar tela quando alguém precisar.
 *
 * O formulário antigo, completo, segue em ./fornecedores/FornecedorDialog.tsx
 * e não é mais referenciado; dá para apagar quando decidirem que não volta.
 *
 * SIS-2026-0209 manteve esse recorte de propósito, mas trouxe para cá o que o
 * gerente de Suprimentos pediu e que antes ficava solto dentro de
 * `observacoes` — o placeholder do campo dizia literalmente "prazo de entrega,
 * condição de pagamento": e-mail do financeiro e da nota fiscal, telefone do
 * vendedor, formas de pagamento, prazos de entrega e de devolução.
 *
 * Banco e PIX aparecem só para leitura: quem preenche é o próprio fornecedor,
 * pelo link público, e quem edita é o Financeiro, dono desse cadastro em
 * títulos a pagar.
 */

const sb = supabase as any;

interface Fornecedor {
  id: string; tipo: string; cnpj_cpf: string | null;
  razao_social: string; nome_fantasia: string | null;
  contato: string | null; telefone: string | null; email: string | null;
  cidade: string | null; uf: string | null;
  observacoes: string | null; ativo: boolean;
  // SIS-2026-0209: o que antes vivia solto dentro de `observacoes` — e o que o
  // fornecedor passa a preencher sozinho pelo link público.
  email_financeiro: string | null; email_nota_fiscal: string | null;
  telefone_vendedor: string | null;
  formas_pagamento: string[] | null;
  condicao_pagamento: string | null; prazo_entrega_dias: number | null;
  devolucao_prazo_dias: number | null; devolucao_procedimento: string | null;
}

const VAZIO: Partial<Fornecedor> = {
  tipo: "pj", cnpj_cpf: "", razao_social: "", nome_fantasia: "",
  contato: "", telefone: "", email: "", cidade: "", uf: "", observacoes: "", ativo: true,
  email_financeiro: "", email_nota_fiscal: "", telefone_vendedor: "",
  formas_pagamento: [], condicao_pagamento: "", prazo_entrega_dias: null,
  devolucao_prazo_dias: null, devolucao_procedimento: "",
};

function mascararDoc(v: string, tipo: string): string {
  const d = v.replace(/\D/g, "").slice(0, tipo === "pj" ? 14 : 11);
  if (tipo === "pj") {
    return d
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}
function mascararTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length > 10) return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
  if (d.length > 6) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  if (d.length > 2) return d.replace(/(\d{2})(\d{0,5})/, "($1) $2");
  return d;
}

export default function Fornecedores() {
  const qc = useQueryClient();
  const { data: empresaId } = useEmpresaId();
  const [editando, setEditando] = useState<Partial<Fornecedor> | null>(null);
  const [materiaisDe, setMateriaisDe] = useState<Fornecedor | null>(null);
  const [busca, setBusca] = useState("");

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["fornecedor", "list"],
    queryFn: async (): Promise<Fornecedor[]> => {
      const { data, error } = await sb
        .from("fornecedor")
        .select(`id, tipo, cnpj_cpf, razao_social, nome_fantasia, contato, telefone, email,
                 cidade, uf, observacoes, ativo,
                 email_financeiro, email_nota_fiscal, telefone_vendedor, formas_pagamento,
                 condicao_pagamento, prazo_entrega_dias, devolucao_prazo_dias, devolucao_procedimento`)
        .order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.razao_social, r.nome_fantasia, r.cnpj_cpf, r.contato, r.cidade]
        .filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [rows, busca]);

  const salvar = useMutation({
    mutationFn: async (f: Partial<Fornecedor>) => {
      if (!f.razao_social?.trim()) throw new Error("Informe a razão social ou o nome.");
      const payload = {
        tipo: f.tipo ?? "pj",
        cnpj_cpf: f.cnpj_cpf || null,
        razao_social: f.razao_social.trim(),
        nome_fantasia: f.nome_fantasia || null,
        contato: f.contato || null,
        telefone: f.telefone || null,
        email: f.email || null,
        cidade: f.cidade || null,
        uf: f.uf ? f.uf.toUpperCase() : null,
        observacoes: f.observacoes || null,
        ativo: f.ativo ?? true,
      };
      if (f.id) {
        const { error } = await sb.from("fornecedor").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("fornecedor").insert({ ...payload, empresa_id: empresaId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedor"] });
      qc.invalidateQueries({ queryKey: ["sup_fornecedores"] });
      toast.success("Fornecedor salvo.");
      setEditando(null);
    },
    onError: (e: any) =>
      toast.error(/duplicate|unique/i.test(e?.message ?? "")
        ? "Já existe fornecedor com esse CNPJ/CPF."
        : e?.message ?? "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await sb.from("fornecedor").delete().eq("id", id).select("id");
      if (error) throw error;
      // DELETE barrado pela RLS não devolve erro, devolve zero linhas.
      if (!data?.length) throw new Error("Nada foi removido — seu perfil não tem a ação 'excluir' em Fornecedores.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedor"] });
      qc.invalidateQueries({ queryKey: ["sup_fornecedores"] });
      toast.success("Fornecedor removido.");
    },
    onError: (e: any) =>
      toast.error(/violates foreign key/i.test(e?.message ?? "")
        ? "Este fornecedor está em uso (estoque ou títulos) e não pode ser removido. Marque como inativo."
        : e?.message ?? "Não foi possível remover."),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fornecedores"
        subtitle="Quem fornece os materiais do almoxarifado. Usado na entrada de estoque."
        module="Suprimentos"
        breadcrumb={["Fornecedores"]}
        actions={
          <Button onClick={() => setEditando({ ...VAZIO })}>
            <Plus className="mr-2 h-4 w-4" /> Novo fornecedor
          </Button>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)}
               placeholder="Buscar por nome, CNPJ, contato, cidade…" className="pl-9" />
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar os fornecedores.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {busca ? `Nenhum resultado para "${busca}"` : "Nenhum fornecedor cadastrado."}
          </p>
          <p className="text-sm text-muted-foreground">
            {busca ? "Tente outro termo." : "Cadastre para poder escolher na entrada de estoque."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>CNPJ / CPF</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.nome_fantasia || r.razao_social}
                      {r.nome_fantasia && (
                        <span className="block text-xs font-normal text-muted-foreground">{r.razao_social}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.cnpj_cpf ?? "—"}</TableCell>
                    <TableCell>
                      {r.contato ?? "—"}
                      {r.telefone && (
                        <span className="block text-xs text-muted-foreground">{r.telefone}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.cidade ? `${r.cidade}${r.uf ? `/${r.uf}` : ""}` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.ativo
                        ? <Badge variant="outline" className="border-emerald-400/50 text-emerald-700 dark:text-emerald-300">Ativo</Badge>
                        : <Badge variant="secondary">Inativo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" title="Materiais que fornece"
                              onClick={() => setMateriaisDe(r)}>
                        <Package className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Editar" onClick={() => setEditando(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Remover"
                              onClick={() => {
                                if (confirm(`Remover "${r.razao_social}"?`)) remover.mutate(r.id);
                              }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={editando?.tipo ?? "pj"}
                  onValueChange={(v) => setEditando((s) => ({ ...s, tipo: v, cnpj_cpf: "" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pj">Pessoa jurídica</SelectItem>
                    <SelectItem value="pf">Pessoa física</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{editando?.tipo === "pf" ? "CPF" : "CNPJ"}</Label>
                <Input
                  value={editando?.cnpj_cpf ?? ""}
                  onChange={(e) => setEditando((s) => ({ ...s, cnpj_cpf: mascararDoc(e.target.value, s?.tipo ?? "pj") }))}
                  placeholder={editando?.tipo === "pf" ? "000.000.000-00" : "00.000.000/0000-00"}
                  className="font-mono"
                />
              </div>
            </div>

            <div>
              <Label>{editando?.tipo === "pf" ? "Nome" : "Razão social"} *</Label>
              <Input
                value={editando?.razao_social ?? ""}
                onChange={(e) => setEditando((s) => ({ ...s, razao_social: e.target.value }))}
                placeholder="Como consta no documento"
              />
            </div>

            {editando?.tipo !== "pf" && (
              <div>
                <Label>Nome fantasia</Label>
                <Input
                  value={editando?.nome_fantasia ?? ""}
                  onChange={(e) => setEditando((s) => ({ ...s, nome_fantasia: e.target.value }))}
                  placeholder="Como o pessoal chama no dia a dia"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Pessoa de contato</Label>
                <Input value={editando?.contato ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, contato: e.target.value }))} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={editando?.telefone ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, telefone: mascararTelefone(e.target.value) }))}
                       placeholder="(00) 00000-0000" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_5rem]">
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={editando?.email ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, email: e.target.value }))} />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input value={editando?.cidade ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, cidade: e.target.value }))} />
              </div>
              <div>
                <Label>UF</Label>
                <Input maxLength={2} value={editando?.uf ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, uf: e.target.value.toUpperCase() }))} />
              </div>
            </div>

            {/* Contatos separados: o e-mail que recebe a nota e o do financeiro
                quase nunca são o comercial, e era o que mais faltava na hora de
                pagar (SIS-2026-0209). */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>E-mail do financeiro</Label>
                <Input type="email" value={editando?.email_financeiro ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, email_financeiro: e.target.value }))} />
              </div>
              <div>
                <Label>E-mail para a nota fiscal</Label>
                <Input type="email" value={editando?.email_nota_fiscal ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, email_nota_fiscal: e.target.value }))} />
              </div>
              <div>
                <Label>Telefone do vendedor</Label>
                <Input value={editando?.telefone_vendedor ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, telefone_vendedor: mascararTelefone(e.target.value) }))}
                       placeholder="(00) 00000-0000" />
              </div>
              <div>
                <Label>Condição de pagamento</Label>
                <Input value={editando?.condicao_pagamento ?? ""}
                       onChange={(e) => setEditando((s) => ({ ...s, condicao_pagamento: e.target.value }))}
                       placeholder="Ex.: 30/60/90 dias" />
              </div>
            </div>

            <div>
              <Label>Formas de pagamento aceitas</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                {FORMAS_PAGAMENTO.map((fp) => {
                  const atuais = editando?.formas_pagamento ?? [];
                  return (
                    <label key={fp.valor} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox" className="h-4 w-4"
                        checked={atuais.includes(fp.valor)}
                        onChange={(e) => setEditando((s) => ({
                          ...s,
                          formas_pagamento: e.target.checked
                            ? [...(s?.formas_pagamento ?? []), fp.valor]
                            : (s?.formas_pagamento ?? []).filter((x) => x !== fp.valor),
                        }))}
                      />
                      {fp.rotulo}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Prazo de entrega (dias)</Label>
                <Input inputMode="numeric" value={editando?.prazo_entrega_dias ?? ""}
                       onChange={(e) => setEditando((s) => ({
                         ...s, prazo_entrega_dias: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")),
                       }))}
                       placeholder="Contado a partir do pedido" />
              </div>
              <div>
                <Label>Prazo de devolução (dias)</Label>
                <Input inputMode="numeric" value={editando?.devolucao_prazo_dias ?? ""}
                       onChange={(e) => setEditando((s) => ({
                         ...s, devolucao_prazo_dias: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")),
                       }))} />
              </div>
            </div>

            <div>
              <Label>Como devolver para este fornecedor</Label>
              <Textarea rows={2} value={editando?.devolucao_procedimento ?? ""}
                        onChange={(e) => setEditando((s) => ({ ...s, devolucao_procedimento: e.target.value }))}
                        placeholder="Assim ninguém precisa ligar para o fornecedor na hora de devolver." />
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={editando?.observacoes ?? ""}
                        onChange={(e) => setEditando((s) => ({ ...s, observacoes: e.target.value }))}
                        placeholder="O que mais for útil na compra." />
            </div>

            {editando?.id && <ContasDoFornecedor fornecedorId={editando.id} />}

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editando?.ativo ?? true}
                onChange={(e) => setEditando((s) => ({ ...s, ativo: e.target.checked }))}
                className="h-4 w-4"
              />
              Ativo — aparece na entrada de estoque
            </label>

            {editando?.id && (
              <p className="text-xs text-muted-foreground">
                Os materiais que este fornecedor fornece são editados pelo ícone de pacote na lista.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button disabled={salvar.isPending} onClick={() => editando && salvar.mutate(editando)}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MateriaisFornecedorDialog fornecedor={materiaisDe} onFechar={() => setMateriaisDe(null)} />
    </div>
  );
}

/**
 * Contas bancárias e PIX, só para LER (SIS-2026-0209).
 *
 * Quem preenche isso é o próprio fornecedor, pelo link público, e quem aprova
 * confere na fila de Cadastros. Aqui aparece para o comprador não precisar
 * pedir o banco por WhatsApp de novo — editar continua sendo assunto do
 * Financeiro, que é dono desse cadastro em títulos a pagar.
 */
function ContasDoFornecedor({ fornecedorId }: { fornecedorId: string }) {
  const { data: contas = [] } = useQuery({
    queryKey: ["fornecedor_conta_bancaria", fornecedorId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("fornecedor_conta_bancaria")
        .select("id, banco_codigo, banco_nome, agencia, agencia_digito, conta, conta_digito, tipo, titular_nome, pix_tipo, pix_chave, principal, ativa")
        .eq("fornecedor_id", fornecedorId)
        .eq("ativa", true)
        .order("principal", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (contas.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Dados bancários
      </p>
      <div className="space-y-2">
        {contas.map((c: any) => (
          <div key={c.id} className="text-xs">
            <p className="font-medium">
              {[c.banco_codigo, c.banco_nome].filter(Boolean).join(" — ") || "Banco não informado"}
              {c.principal && <span className="ml-2 text-muted-foreground">(principal)</span>}
            </p>
            <p className="text-muted-foreground">
              {[
                c.agencia && `Ag. ${[c.agencia, c.agencia_digito].filter(Boolean).join("-")}`,
                c.conta && `Conta ${[c.conta, c.conta_digito].filter(Boolean).join("-")}`,
                c.tipo, c.titular_nome,
              ].filter(Boolean).join(" · ")}
            </p>
            {c.pix_chave && (
              <p className="text-muted-foreground">PIX ({c.pix_tipo || "—"}): {c.pix_chave}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
