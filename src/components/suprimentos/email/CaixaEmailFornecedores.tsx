import { useEffect, useMemo, useState } from "react";
import {
  Pencil, Send, FileEdit, AlertOctagon, Inbox, Search, X, Paperclip, ArrowLeft, Forward,
  RotateCcw, Trash2, Download, Loader2, Building2, Signature, Mail, Reply,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  baixarAnexo, useConfigEnvio, useContagemPastas, useEmailsFornecedor, useExcluirEmail,
  type EmailFornecedor, type PastaEmail,
} from "@/hooks/useFornecedorEmail";
import {
  corpoEncaminhado, dataCurta, enderecosDosFornecedores, formatarTamanho, textoDoHtml,
  type FornecedorComEmails,
} from "@/lib/suprimentos/fornecedorEmail";
import { EscreverEmail, chaveAssinatura, lerAssinatura, type MensagemInicial } from "./EscreverEmail";

/**
 * Caixa de e-mail de Fornecedores (Suprimentos) — o "Gmail" da tela.
 *
 * Barra lateral com Escrever e as pastas (Enviados, Rascunhos, Falhas,
 * Todos), lista no meio e leitura à direita. A caixa é COMPARTILHADA: quem
 * tem `fornecedores_email · visualizar` vê tudo o que saiu, de qualquer
 * pessoa — o histórico com o fornecedor é da empresa, não de quem escreveu.
 * Rascunho é só do autor (RLS).
 *
 * Gate: menu fantasma `fornecedores_email` (mig 20261106009500):
 *   visualizar = abrir a caixa · incluir = escrever/enviar · excluir = apagar enviada.
 */

const PASTAS: { id: PastaEmail; nome: string; icone: typeof Send }[] = [
  { id: "enviados", nome: "Enviados", icone: Send },
  { id: "rascunhos", nome: "Rascunhos", icone: FileEdit },
  { id: "falhas", nome: "Falhas", icone: AlertOctagon },
  { id: "todos", nome: "Todos", icone: Inbox },
];

export interface AberturaCaixa {
  /** Filtra a caixa por este fornecedor. */
  fornecedor?: FornecedorComEmails | null;
  /** Abre já com "Nova mensagem" para ele. */
  escrever?: boolean;
}

export function CaixaEmailFornecedores({
  aberta, onOpenChange, fornecedores, abertura,
}: {
  aberta: boolean;
  onOpenChange: (v: boolean) => void;
  fornecedores: FornecedorComEmails[];
  abertura: AberturaCaixa | null;
}) {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeVer = can("visualizar", "suprimentos", "fornecedores_email");
  const podeEscrever = can("incluir", "suprimentos", "fornecedores_email");
  const podeExcluir = can("excluir", "suprimentos", "fornecedores_email");

  const [pasta, setPasta] = useState<PastaEmail>("enviados");
  const [foco, setFoco] = useState<FornecedorComEmails | null>(null);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(100);
  const [selecionado, setSelecionado] = useState<EmailFornecedor | null>(null);
  const [escrevendo, setEscrevendo] = useState<{ chave: number; inicial: MensagemInicial } | null>(null);
  const [editandoAssinatura, setEditandoAssinatura] = useState(false);

  const sugestoes = useMemo(() => enderecosDosFornecedores(fornecedores), [fornecedores]);
  const nomeFornecedor = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fornecedores) m.set(f.id, f.nome_fantasia || f.razao_social);
    return m;
  }, [fornecedores]);

  const config = useConfigEnvio(aberta && podeEscrever);
  const lista = useEmailsFornecedor(pasta, foco?.id ?? null, limite, aberta && podeVer);
  const contagem = useContagemPastas(foco?.id ?? null, aberta && podeVer);
  const excluir = useExcluirEmail();

  const novaPara = (f: FornecedorComEmails | null | undefined): MensagemInicial => {
    if (!f) return {};
    const enderecos = sugestoes.filter((s) => s.fornecedorId === f.id);
    const principal = enderecos.find((s) => s.rotulo === "Principal") ?? enderecos[0];
    return { para: principal ? [principal.email] : [], fornecedor_ids: [f.id] };
  };

  // Cada abertura da caixa começa do jeito pedido pela linha clicada.
  useEffect(() => {
    if (!aberta) return;
    setFoco(abertura?.fornecedor ?? null);
    setSelecionado(null);
    setBusca("");
    setPasta("enviados");
    setLimite(100);
    if (abertura?.escrever && podeEscrever) {
      const ini = novaPara(abertura.fornecedor);
      if (abertura.fornecedor && !ini.para?.length) {
        toast.message("Este fornecedor não tem e-mail cadastrado — digite o endereço em Para.");
      }
      setEscrevendo({ chave: Date.now(), inicial: ini });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, abertura]);

  const abrirEscrever = (inicial: MensagemInicial) => {
    if (escrevendo) { toast.message("Feche a mensagem que está aberta antes de começar outra."); return; }
    setEscrevendo({ chave: Date.now(), inicial });
  };

  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const todos = lista.data?.itens ?? [];
    if (!t) return todos;
    return todos.filter((m) =>
      [m.assunto, ...m.para, ...m.cc, ...m.cco, m.autor_nome ?? "", textoDoHtml(m.corpo_html),
       ...m.fornecedor_ids.map((id) => nomeFornecedor.get(id) ?? "")]
        .join(" ").toLowerCase().includes(t));
  }, [lista.data, busca, nomeFornecedor]);

  // Seleção some se a mensagem saiu da pasta (ex.: rascunho enviado).
  useEffect(() => {
    if (selecionado && lista.data && !lista.data.itens.some((m) => m.id === selecionado.id)) setSelecionado(null);
    else if (selecionado) {
      const novo = lista.data?.itens.find((m) => m.id === selecionado.id);
      if (novo && novo.updated_at !== selecionado.updated_at) setSelecionado(novo);
    }
  }, [lista.data, selecionado]);

  const clicarItem = (m: EmailFornecedor) => {
    if (m.status === "rascunho") {
      if (m.autor_id !== user?.id) return;
      abrirEscrever({
        id: m.id, para: m.para, cc: m.cc, cco: m.cco, assunto: m.assunto,
        html: m.corpo_html, anexos: m.anexos, fornecedor_ids: m.fornecedor_ids,
      });
      return;
    }
    setSelecionado(m);
  };

  const encaminhar = (m: EmailFornecedor) => abrirEscrever({
    assunto: /^enc:/i.test(m.assunto) ? m.assunto : `Enc: ${m.assunto}`,
    html: corpoEncaminhado(m),
    anexos: m.anexos,
    fornecedor_ids: m.fornecedor_ids,
  });

  const tentarDeNovo = (m: EmailFornecedor) => abrirEscrever({
    para: m.para, cc: m.cc, cco: m.cco, assunto: m.assunto, html: m.corpo_html,
    anexos: m.anexos, fornecedor_ids: m.fornecedor_ids,
  });

  const novaParaOsMesmos = (m: EmailFornecedor) => abrirEscrever({
    para: m.para, cc: m.cc,
    assunto: /^re:/i.test(m.assunto) ? m.assunto : `Re: ${m.assunto}`,
    fornecedor_ids: m.fornecedor_ids,
  });

  const apagar = async (m: EmailFornecedor) => {
    if (!window.confirm(m.status === "rascunho" ? "Descartar este rascunho?" : "Apagar esta mensagem do histórico? Ela já foi enviada — isso só tira do ERP.")) return;
    try {
      await excluir.mutateAsync(m);
      setSelecionado(null);
      toast.success("Mensagem apagada.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível apagar.");
    }
  };

  const destinatarioDaLinha = (m: EmailFornecedor) => {
    const nomes = m.fornecedor_ids.map((id) => nomeFornecedor.get(id)).filter(Boolean) as string[];
    if (nomes.length) return nomes.join(", ");
    return m.para.join(", ") || "(sem destinatário)";
  };

  return (
    <Dialog open={aberta} onOpenChange={(v) => { if (!v && escrevendo) { toast.message("Feche (ou envie) a mensagem aberta antes de sair."); return; } onOpenChange(v); }}>
      <DialogContent
        className="flex h-[94vh] w-[calc(100vw-1rem)] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only"><DialogTitle>E-mails de fornecedores</DialogTitle></DialogHeader>

        {/* Topo */}
        <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-5 w-5" /></span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">E-mails</p>
              <p className="text-xs text-muted-foreground">Fornecedores</p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar e-mail (assunto, destinatário, fornecedor, texto)"
              className="h-10 w-full rounded-full bg-muted pl-10 pr-10 text-sm outline-none focus:bg-background focus:ring-2 focus:ring-ring"
            />
            {busca && (
              <button type="button" onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Limpar busca">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* Barra lateral */}
          <aside className="hidden w-60 shrink-0 flex-col gap-1 p-3 md:flex">
            {podeEscrever && (
              <Button onClick={() => abrirEscrever(novaPara(foco))} className="mb-3 h-12 justify-start gap-3 rounded-2xl px-5 shadow-sm" size="lg">
                <Pencil className="h-5 w-5" /> Escrever
              </Button>
            )}
            {PASTAS.map((p) => {
              const n = p.id === "rascunhos" ? contagem.data?.rascunhos : p.id === "falhas" ? contagem.data?.falhas : undefined;
              const Icone = p.icone;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPasta(p.id); setSelecionado(null); setLimite(100); }}
                  className={cn(
                    "flex items-center gap-3 rounded-r-full px-4 py-2 text-sm",
                    pasta === p.id ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted",
                  )}
                >
                  <Icone className="h-4 w-4" />
                  <span className="flex-1 text-left">{p.nome}</span>
                  {!!n && <span className={cn("text-xs", p.id === "falhas" && "font-semibold text-destructive")}>{n}</span>}
                </button>
              );
            })}
            <div className="my-3 h-px bg-border" />
            {foco && (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                <p className="mb-1 text-muted-foreground">Filtrando por fornecedor</p>
                <p className="flex items-center gap-1.5 font-medium"><Building2 className="h-3.5 w-3.5" /> {foco.nome_fantasia || foco.razao_social}</p>
                <button type="button" className="mt-2 text-primary hover:underline" onClick={() => setFoco(null)}>Ver todos os fornecedores</button>
              </div>
            )}
            {podeEscrever && (
              <button type="button" onClick={() => setEditandoAssinatura(true)} className="mt-auto flex items-center gap-3 rounded-r-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted">
                <Signature className="h-4 w-4" /> Minha assinatura
              </button>
            )}
          </aside>

          {/* Lista + leitura */}
          <div className="flex min-w-0 flex-1 border-l">
            <section className={cn("flex min-w-0 flex-col", selecionado ? "hidden lg:flex lg:w-[42%] lg:border-r" : "flex-1")}>
              {/* Pastas no celular */}
              <div className="flex gap-1 overflow-x-auto border-b px-2 py-2 md:hidden">
                {PASTAS.map((p) => (
                  <Button key={p.id} size="sm" variant={pasta === p.id ? "secondary" : "ghost"} onClick={() => { setPasta(p.id); setSelecionado(null); }}>
                    {p.nome}
                  </Button>
                ))}
                {foco && (
                  <Badge variant="outline" className="ml-1 shrink-0 gap-1">
                    {foco.nome_fantasia || foco.razao_social}
                    <button type="button" onClick={() => setFoco(null)} aria-label="Tirar filtro"><X className="h-3 w-3" /></button>
                  </Badge>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!podeVer ? (
                  <Vazio titulo="Sem acesso ao histórico" texto="Você pode escrever e enviar, mas ver a caixa pede a ação 'visualizar' em Fornecedores — E-mails." />
                ) : lista.isLoading ? (
                  <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
                ) : lista.error ? (
                  <Vazio titulo="Não foi possível carregar" texto={(lista.error as Error).message} />
                ) : itens.length === 0 ? (
                  <Vazio
                    titulo={busca ? `Nada encontrado para "${busca}"` : pasta === "rascunhos" ? "Nenhum rascunho" : pasta === "falhas" ? "Nenhuma falha de envio" : "Nenhuma mensagem enviada"}
                    texto={busca ? "Tente outro termo." : podeEscrever ? "Clique em Escrever para mandar a primeira." : ""}
                  />
                ) : (
                  <ul>
                    {itens.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => clicarItem(m)}
                          className={cn(
                            "group flex w-full items-center gap-3 border-b px-4 py-2.5 text-left text-sm hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_0_rgba(60,64,67,.3)]",
                            selecionado?.id === m.id && "bg-primary/5",
                          )}
                        >
                          <span className="w-36 shrink-0 truncate font-medium sm:w-44">
                            {m.status === "rascunho" ? <span className="text-destructive">Rascunho</span> : <>Para: {destinatarioDaLinha(m)}</>}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {m.status === "falhou" && <Badge variant="destructive" className="mr-2 px-1.5 py-0 text-[10px]">Falhou</Badge>}
                            {m.status === "enviando" && <Badge variant="secondary" className="mr-2 px-1.5 py-0 text-[10px]">Enviando</Badge>}
                            <span className="font-medium">{m.assunto || "(sem assunto)"}</span>
                            <span className="text-muted-foreground"> — {textoDoHtml(m.corpo_html).slice(0, 140)}</span>
                          </span>
                          {m.anexos?.length > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                            {dataCurta(m.enviado_em ?? m.updated_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {lista.data?.temMais && !busca && (
                  <div className="p-4 text-center">
                    <Button variant="outline" size="sm" onClick={() => setLimite((l) => l + 100)}>Carregar mais</Button>
                  </div>
                )}
              </div>
            </section>

            {selecionado && (
              <Leitura
                m={selecionado}
                nomeFornecedor={nomeFornecedor}
                onVoltar={() => setSelecionado(null)}
                onEncaminhar={podeEscrever ? () => encaminhar(selecionado) : undefined}
                onNovaParaOsMesmos={podeEscrever ? () => novaParaOsMesmos(selecionado) : undefined}
                onTentarDeNovo={podeEscrever && selecionado.status === "falhou" ? () => tentarDeNovo(selecionado) : undefined}
                onApagar={podeExcluir ? () => apagar(selecionado) : undefined}
              />
            )}
          </div>

          {podeEscrever && !escrevendo && (
            <Button onClick={() => abrirEscrever(novaPara(foco))} className="absolute bottom-4 right-4 h-14 w-14 rounded-2xl shadow-lg md:hidden" size="icon" aria-label="Escrever">
              <Pencil className="h-6 w-6" />
            </Button>
          )}

          {escrevendo && user && (
            <EscreverEmail
              key={escrevendo.chave}
              inicial={escrevendo.inicial}
              uid={user.id}
              config={config.data}
              sugestoes={sugestoes}
              onFechar={() => setEscrevendo(null)}
            />
          )}
        </div>

        <AssinaturaDialog aberta={editandoAssinatura} onOpenChange={setEditandoAssinatura} uid={user?.id} />
      </DialogContent>
    </Dialog>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/40" />
      <p className="font-medium">{titulo}</p>
      {texto && <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>}
    </div>
  );
}

function Leitura({
  m, nomeFornecedor, onVoltar, onEncaminhar, onNovaParaOsMesmos, onTentarDeNovo, onApagar,
}: {
  m: EmailFornecedor;
  nomeFornecedor: Map<string, string>;
  onVoltar: () => void;
  onEncaminhar?: () => void;
  onNovaParaOsMesmos?: () => void;
  onTentarDeNovo?: () => void;
  onApagar?: () => void;
}) {
  const [baixando, setBaixando] = useState<string | null>(null);
  const quando = new Date(m.enviado_em ?? m.updated_at).toLocaleString("pt-BR", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  // Corpo num iframe SEM allow-scripts/allow-same-origin: o HTML é de quem
  // escreveu (pode ter vindo colado de qualquer lugar) e não pode rodar nada
  // no ERP. <base target=_blank> faz os links abrirem fora.
  const documento = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">`
    + `<style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124;margin:0;padding:4px 2px;word-wrap:break-word}`
    + `blockquote{border-left:2px solid #ccc;margin:0 0 0 .8ex;padding-left:1ex;color:#555}img{max-width:100%}</style></head>`
    + `<body>${m.corpo_html || "<p style='color:#888'>(sem texto)</p>"}</body></html>`;

  const linha = (rotulo: string, valor: string[]) => valor.length > 0 && (
    <p className="truncate"><span className="text-muted-foreground">{rotulo}: </span>{valor.join(", ")}</p>
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button size="icon" variant="ghost" onClick={onVoltar} title="Voltar à lista"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1" />
        {onTentarDeNovo && (
          <Button size="sm" variant="outline" onClick={onTentarDeNovo}><RotateCcw className="mr-1.5 h-4 w-4" /> Corrigir e reenviar</Button>
        )}
        {onNovaParaOsMesmos && (
          <Button size="icon" variant="ghost" onClick={onNovaParaOsMesmos} title="Nova mensagem para os mesmos destinatários"><Reply className="h-4 w-4" /></Button>
        )}
        {onEncaminhar && (
          <Button size="icon" variant="ghost" onClick={onEncaminhar} title="Encaminhar"><Forward className="h-4 w-4" /></Button>
        )}
        {onApagar && (
          <Button size="icon" variant="ghost" onClick={onApagar} title="Apagar do histórico"><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        <h2 className="mb-3 flex flex-wrap items-center gap-2 text-xl font-normal">
          {m.assunto || "(sem assunto)"}
          {m.status === "falhou" && <Badge variant="destructive">Falhou</Badge>}
          {m.status === "enviando" && <Badge variant="secondary">Enviando</Badge>}
          {m.fornecedor_ids.map((id) => nomeFornecedor.get(id) && (
            <Badge key={id} variant="outline" className="gap-1 font-normal"><Building2 className="h-3 w-3" />{nomeFornecedor.get(id)}</Badge>
          ))}
        </h2>

        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {(m.autor_nome ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="truncate"><b>{m.de_nome ?? m.autor_nome}</b> <span className="text-xs text-muted-foreground">&lt;{m.de_email}&gt;</span></p>
              <span className="text-xs text-muted-foreground">{quando}</span>
            </div>
            <div className="text-xs">
              {linha("Para", m.para)}
              {linha("Cc", m.cc)}
              {linha("Cco", m.cco)}
              {m.responder_para && <p className="truncate"><span className="text-muted-foreground">Responder para: </span>{m.responder_para}</p>}
            </div>
          </div>
        </div>

        {m.status === "falhou" && m.erro && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">A mensagem não saiu.</p>
            <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{m.erro}</p>
          </div>
        )}

        <iframe
          title="Corpo da mensagem"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={documento}
          className="min-h-[320px] w-full flex-1 rounded border-0 bg-white"
        />

        {m.anexos?.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="mb-2 text-sm font-medium">{m.anexos.length} anexo{m.anexos.length > 1 ? "s" : ""}</p>
            <div className="flex flex-wrap gap-2">
              {m.anexos.map((a) => (
                <button
                  key={a.path}
                  type="button"
                  disabled={baixando === a.path}
                  onClick={async () => {
                    setBaixando(a.path);
                    try { await baixarAnexo(a); } catch (e: any) { toast.error(e?.message ?? "Não foi possível baixar."); }
                    finally { setBaixando(null); }
                  }}
                  className="flex w-52 items-center gap-2 rounded-md border p-2 text-left text-xs hover:bg-muted"
                >
                  {baixando === a.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-primary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.nome}</span>
                    <span className="text-muted-foreground">{formatarTamanho(a.tamanho ?? 0)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {m.autor_nome && <p className="mt-4 text-xs text-muted-foreground">Enviado pelo ERP por {m.autor_nome}.</p>}
      </div>
    </section>
  );
}

function AssinaturaDialog({ aberta, onOpenChange, uid }: { aberta: boolean; onOpenChange: (v: boolean) => void; uid: string | undefined }) {
  const [texto, setTexto] = useState("");
  useEffect(() => { if (aberta) setTexto(lerAssinatura(uid)); }, [aberta, uid]);
  return (
    <Dialog open={aberta} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Minha assinatura</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Entra no fim de toda mensagem nova. Fica salva neste navegador.</p>
        <Textarea
          rows={6}
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, 1000))}
          placeholder={"Fulano de Tal\nCompras · Grupo Nascimento\n(00) 00000-0000"}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => {
            try { localStorage.setItem(chaveAssinatura(uid), texto.trim()); } catch { /* navegador sem storage */ }
            toast.success("Assinatura salva.");
            onOpenChange(false);
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
