import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import {
  useCadastrosPendentes, useConvites, useCnpjExistente, useGerarConvite,
  useAprovarCadastro, useReprovarCadastro, linkDoConvite, fmtDataHora, fmtDoc,
  CAMPOS_COMPARAVEIS, FORMAS_PAGAMENTO, decidirDestino,
  type CadastroPendente,
} from "@/hooks/useFornecedorCadastro";
import {
  Link2, Copy, Inbox, CheckCircle2, XCircle, Clock, AlertTriangle, Building2, Loader2, PencilLine,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// RPC nova, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Cadastros de Fornecedor — a fila do que veio de fora (SIS-2026-0209).
 *
 * Duas coisas na mesma tela, porque são as duas pontas do mesmo fluxo: gerar o
 * link que vai pro fornecedor, e decidir o que ele mandou de volta.
 *
 * A EMPRESA é escolhida aqui, não pelo fornecedor: public.fornecedor tem
 * UNIQUE (empresa_id, cnpj_cpf), e quem está de fora não conhece a estrutura
 * de empresas do grupo. É também aqui que se descobre se o CNPJ já existe —
 * daí a aprovação vira ATUALIZAÇÃO do cadastro que já está lá, em vez de tentar
 * criar um duplicado e esbarrar na constraint.
 */

const ESTILO_STATUS: Record<string, { classe: string; rotulo: string; icone: any }> = {
  pendente:  { classe: "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", rotulo: "Aguardando aprovação", icone: Clock },
  aprovado:  { classe: "border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", rotulo: "Aprovado", icone: CheckCircle2 },
  reprovado: { classe: "border-destructive/40 bg-destructive/5 text-destructive", rotulo: "Reprovado", icone: XCircle },
};

export default function FornecedoresPendentes() {
  const { data: pendentes = [], isLoading } = useCadastrosPendentes();
  const { data: convites = [] } = useConvites();
  const gerar = useGerarConvite();

  const [abrindo, setAbrindo] = useState<CadastroPendente | null>(null);
  const [convitando, setConvidando] = useState(false);
  const [destinatario, setDestinatario] = useState("");
  const [observacao, setObservacao] = useState("");
  const [ultimoLink, setUltimoLink] = useState<string | null>(null);

  const fila = useMemo(() => pendentes.filter((p) => p.status === "pendente"), [pendentes]);
  const decididos = useMemo(() => pendentes.filter((p) => p.status !== "pendente"), [pendentes]);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Link copiado — é só colar no WhatsApp.");
    } catch {
      toast.error("Não consegui copiar. Selecione o link e copie na mão.");
    }
  };

  const gerarLink = async () => {
    const c = await gerar.mutateAsync({
      destinatario: destinatario.trim() || undefined,
      observacao: observacao.trim() || undefined,
    });
    const url = linkDoConvite(c.token);
    setUltimoLink(url);
    setDestinatario(""); setObservacao("");
    await copiar(url);
  };

  /**
   * Cadastro de e-commerce: quem preenche somos nós.
   *
   * Ninguém na Amazon vai receber um link nosso e preencher razão social e
   * dados bancários — mas a compra acontece e o fornecedor precisa existir.
   *
   * Reusa o MESMO convite, o MESMO formulário e a MESMA aprovação. A única
   * diferença é a marca de origem, para quem aprova saber se o dado veio do
   * fornecedor ou foi transcrito por nós a partir do site dele. Um "cadastro
   * rápido" que gravasse direto em `fornecedor` seria mais curto e criaria
   * dois caminhos para o mesmo dado, um validado e outro não.
   */
  const preencherEuMesmo = async () => {
    const c = await gerar.mutateAsync({
      destinatario: destinatario.trim() || undefined,
      observacao: observacao.trim() || undefined,
    });
    const { error } = await sb.rpc("sup_forn_marcar_convite_interno", { p_convite_id: c.id });
    if (error) { toast.error(error.message); return; }
    setConvidando(false);
    setDestinatario(""); setObservacao("");
    // Aba nova: o formulário é a rota pública, e trocar de página aqui faria
    // a pessoa perder a fila de aprovação que ela estava olhando.
    window.open(linkDoConvite(c.token), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cadastros de Fornecedor"
        subtitle="Gere o link para o fornecedor preencher os próprios dados e aprove o que ele enviar."
        module="Suprimentos"
        breadcrumb={["Fornecedores", "Cadastros"]}
        actions={
          <Button onClick={() => setConvidando(true)}>
            <Link2 className="mr-2 h-4 w-4" /> Gerar link
          </Button>
        }
      />

      <Tabs defaultValue="fila">
        <TabsList>
          <TabsTrigger value="fila">Aguardando ({fila.length})</TabsTrigger>
          <TabsTrigger value="decididos">Decididos ({decididos.length})</TabsTrigger>
          <TabsTrigger value="convites">Links enviados ({convites.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="mt-4">
          {isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : fila.length === 0 ? (
            <Vazio texto="Nenhum cadastro aguardando." dica="Gere um link e mande para o fornecedor preencher." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {fila.map((p) => <CardPendente key={p.id} p={p} onAbrir={() => setAbrindo(p)} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="decididos" className="mt-4">
          {decididos.length === 0 ? (
            <Vazio texto="Nada decidido ainda." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {decididos.map((p) => <CardPendente key={p.id} p={p} onAbrir={() => setAbrindo(p)} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="convites" className="mt-4">
          {convites.length === 0 ? (
            <Vazio texto="Nenhum link gerado." />
          ) : (
            <Card><CardContent className="divide-y p-0">
              {convites.map((c) => {
                const expirado = c.expira_em && new Date(c.expira_em) < new Date();
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.destinatario || "sem destinatário anotado"}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.criado_por_nome ?? "—"} · {fmtDataHora(c.created_at)}
                        {c.usado_em ? " · usado" : expirado ? " · expirado" : ""}
                      </p>
                    </div>
                    {!c.usado_em && !expirado && (
                      <Button variant="ghost" size="sm" onClick={() => copiar(linkDoConvite(c.token))}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={convitando} onOpenChange={(v) => { setConvidando(v); if (!v) setUltimoLink(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gerar link de cadastro</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O link vale por 30 dias e só pode ser usado uma vez. Ele não pede
              login — o fornecedor abre, preenche e envia.
            </p>
            <div>
              <Label className="text-xs">Para quem é (opcional)</Label>
              <Input className="mt-1" value={destinatario} onChange={(e) => setDestinatario(e.target.value)}
                     placeholder="Nome da empresa ou do vendedor" />
            </div>
            <div>
              <Label className="text-xs">Observação (opcional)</Label>
              <Input className="mt-1" value={observacao} onChange={(e) => setObservacao(e.target.value)}
                     placeholder="Ex.: fornecedor de uniforme indicado pelo Senilto" />
            </div>
            {ultimoLink && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Link gerado e copiado
                </p>
                <p className="break-all font-mono text-xs">{ultimoLink}</p>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <p className="mr-auto max-w-sm text-left text-xs text-muted-foreground">
              É uma compra em site como Shopee, Amazon ou AliExpress? Não há a quem mandar o
              link — use <strong>Preencher eu mesmo</strong>.
            </p>
            <Button variant="outline" onClick={() => { setConvidando(false); setUltimoLink(null); }}>
              Fechar
            </Button>
            <Button variant="outline" onClick={preencherEuMesmo} disabled={gerar.isPending}>
              <PencilLine className="mr-2 h-4 w-4" /> Preencher eu mesmo
            </Button>
            <Button onClick={gerarLink} disabled={gerar.isPending}>
              {gerar.isPending ? "Gerando…" : ultimoLink ? "Gerar outro" : "Gerar e copiar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalDecisao pendente={abrindo} onFechar={() => setAbrindo(null)} />
    </div>
  );
}

function Vazio({ texto, dica }: { texto: string; dica?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/50" />
      <p className="font-medium">{texto}</p>
      {dica && <p className="text-sm text-muted-foreground">{dica}</p>}
    </div>
  );
}

function CardPendente({ p, onAbrir }: { p: CadastroPendente; onAbrir: () => void }) {
  const e = ESTILO_STATUS[p.status] ?? ESTILO_STATUS.pendente;
  const Icone = e.icone;
  return (
    <Card className="cursor-pointer transition-colors hover:bg-muted/40" onClick={onAbrir}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.razao_social}</p>
            <p className="font-mono text-xs text-muted-foreground">{fmtDoc(p.cnpj_cpf)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className={cn("gap-1", e.classe)}>
              <Icone className="h-3 w-3" /> {e.rotulo}
            </Badge>
            {/* Quem aprova precisa saber a origem: dado que o proprio
                fornecedor preencheu tem outro peso que um transcrito por nos. */}
            {p.interno && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <PencilLine className="h-3 w-3" /> preenchido internamente
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Enviado em {fmtDataHora(p.created_at)}
          {p.decidido_por_nome && ` · por ${p.decidido_por_nome}`}
        </p>
        {p.motivo_reprovacao && (
          <p className="text-xs text-destructive">Motivo: {p.motivo_reprovacao}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Decisão do cadastro: escolhe a empresa, vê o de-para e aprova ou reprova. */
function ModalDecisao({ pendente: p, onFechar }: { pendente: CadastroPendente | null; onFechar: () => void }) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: existentes = [] } = useCnpjExistente(p?.cnpj_cpf ?? null);
  const aprovar = useAprovarCadastro();
  const reprovar = useReprovarCadastro();

  const [empresaId, setEmpresaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [campos, setCampos] = useState<string[] | null>(null);

  if (!p) return null;
  const decidido = p.status !== "pendente";

  // Já existe esse CNPJ NA EMPRESA escolhida? Então é atualização.
  const destino = decidirDestino(existentes, empresaId || null);
  const jaExiste = destino.tipo === "atualizacao" ? destino.alvo : undefined;
  const emOutras = destino.existeEmOutras;

  const confirmar = async () => {
    if (!empresaId) { toast.error("Escolha a empresa do cadastro."); return; }
    await aprovar.mutateAsync({ id: p.id, empresaId, campos: jaExiste ? campos : null });
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {p.razao_social}
            <span className="font-mono text-sm font-normal text-muted-foreground">{fmtDoc(p.cnpj_cpf)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {existentes.length > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">Este CNPJ já está cadastrado</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {existentes.map((f) => f.razao_social).join(" · ")}
                  {" — "}escolha a empresa abaixo para ver se é o mesmo cadastro ou um novo.
                </p>
              </div>
            </div>
          )}

          <Bloco titulo="Contatos" itens={[
            ["E-mail comercial", p.email], ["E-mail do financeiro", p.email_financeiro],
            ["E-mail da nota fiscal", p.email_nota_fiscal], ["Contato", p.contato],
            ["Telefone", p.telefone], ["Telefone do vendedor", p.telefone_vendedor],
          ]} />

          <Bloco titulo="Empresa" itens={[
            ["Nome fantasia", p.nome_fantasia], ["Inscrição estadual", p.inscricao_estadual],
            ["CNAE", p.cnae_principal],
          ]} />

          <Bloco titulo="Endereço" itens={[
            ["Logradouro", [p.logradouro, p.numero, p.complemento].filter(Boolean).join(", ")],
            ["Bairro", p.bairro], ["Cidade", [p.cidade, p.uf].filter(Boolean).join(" / ")], ["CEP", p.cep],
          ]} />

          <Bloco titulo="Comercial" itens={[
            ["Formas de pagamento", p.formas_pagamento?.map(
              (v) => FORMAS_PAGAMENTO.find((f) => f.valor === v)?.rotulo ?? v).join(", ")],
            ["Condição de pagamento", p.condicao_pagamento],
            ["Prazo de entrega", p.prazo_entrega_dias ? `${p.prazo_entrega_dias} dias` : null],
            ["Prazo de devolução", p.devolucao_prazo_dias ? `${p.devolucao_prazo_dias} dias` : null],
            ["Como devolver", p.devolucao_procedimento],
            ["Observações", p.observacoes],
          ]} />

          {p.contas_bancarias?.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Contas bancárias</h4>
              <div className="space-y-2">
                {p.contas_bancarias.map((c, i) => (
                  <div key={i} className="rounded-md border p-2 text-xs">
                    <p>{[c.banco_codigo, c.banco_nome].filter(Boolean).join(" — ") || "Sem banco informado"}</p>
                    <p className="text-muted-foreground">
                      {[c.agencia && `Ag. ${c.agencia}`, c.conta && `Conta ${c.conta}`, c.tipo].filter(Boolean).join(" · ")}
                    </p>
                    {c.pix_chave && <p className="text-muted-foreground">PIX ({c.pix_tipo || "—"}): {c.pix_chave}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!decidido && (
            <>
              <div>
                <Label className="text-xs">Empresa do cadastro *</Label>
                <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setCampos(null); }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha a empresa…" /></SelectTrigger>
                  <SelectContent>
                    {empresas.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {emOutras.length > 0 && empresaId && !jaExiste && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Existe em outra empresa do grupo, mas não nesta — será um cadastro novo aqui.
                  </p>
                )}
              </div>

              {jaExiste && (
                <div className="rounded-md border border-blue-400/40 bg-blue-50/60 p-3 dark:bg-blue-950/20">
                  <div className="mb-2 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-medium">Atualização de "{jaExiste.razao_social}"</p>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Marque o que deve sobrescrever o cadastro atual. Sem marcar
                    nada, tudo que o fornecedor preencheu é aplicado.
                  </p>
                  <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                    {CAMPOS_COMPARAVEIS.filter((c) => {
                      const v = p[c.chave];
                      return Array.isArray(v) ? v.length > 0 : v !== null && v !== "";
                    }).map((c) => (
                      <label key={String(c.chave)} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={campos?.includes(String(c.chave)) ?? false}
                          onCheckedChange={(ck) =>
                            setCampos((atual) => {
                              const base = atual ?? [];
                              return ck ? [...base, String(c.chave)] : base.filter((x) => x !== String(c.chave));
                            })
                          }
                        />
                        {c.rotulo}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {reprovando && (
                <div>
                  <Label className="text-xs">Motivo da reprovação *</Label>
                  <Textarea className="mt-1" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ex.: CNPJ não confere com a razão social informada." />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          {!decidido && (reprovando ? (
            <>
              <Button variant="ghost" onClick={() => setReprovando(false)}>Voltar</Button>
              <Button variant="destructive" disabled={reprovar.isPending}
                      onClick={async () => { await reprovar.mutateAsync({ id: p.id, motivo }); onFechar(); }}>
                Confirmar reprovação
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" onClick={() => setReprovando(true)}>Reprovar</Button>
              <Button onClick={confirmar} disabled={aprovar.isPending || !empresaId}>
                {aprovar.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aprovando…</>
                  : jaExiste ? "Aprovar atualização" : "Aprovar cadastro"}
              </Button>
            </>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bloco({ titulo, itens }: { titulo: string; itens: [string, any][] }) {
  const validos = itens.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (validos.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">{titulo}</h4>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
        {validos.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
