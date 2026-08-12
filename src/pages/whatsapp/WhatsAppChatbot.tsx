import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useToast } from "@/hooks/use-toast";
import { novoUuid, erroDaFunction } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bot, ShieldAlert, Plus, Trash2, Save, Power, Inbox, Info, MousePointerClick, FolderTree, Image as ImageIcon } from "lucide-react";
import { MODELOS, PROVEDORES, DIAS, MENU_ACOES, RETOMADA_MAX_MIN, fmtMinutos, type WaBotConfig, type WaConhecimento, type WaMenu, type WaMenuOpcao, type WaMenuAcao, type WaPasta, type WaProvedor } from "./types";
import { SUPABASE_URL } from "@/integrations/supabase/env";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const SECRETS_META = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];

const novoIdOpcao = () => `o_${Math.random().toString(36).slice(2, 8)}`;

// A IA só atende quando alguma opção (em qualquer nível) leva a ela — este
// helper alimenta a nota informativa da tela.
const temOpcaoIA = (opcoes: WaMenuOpcao[]): boolean =>
  opcoes.some((o) => o.acao === "ia" || (o.acao === "submenu" && temOpcaoIA(o.submenu?.opcoes ?? [])));

// ---- Editor recursivo do menu em cascata -----------------------------------
// Cada opção pode responder um texto, abrir MAIS opções (submenu), encaminhar
// pra IA ou pra atendente. Os componentes se chamam mutuamente para desenhar a
// árvore em qualquer profundidade; cada nível tem os mesmos limites do
// WhatsApp (até 3 opções viram botões; 4–10 viram lista).
function OpcoesEditor({ opcoes, nivel, pastas, onChange }: {
  opcoes: WaMenuOpcao[]; nivel: number; pastas: WaPasta[]; onChange: (ops: WaMenuOpcao[]) => void;
}) {
  const setAt = (i: number, nova: WaMenuOpcao) => onChange(opcoes.map((o, j) => (j === i ? nova : o)));
  const removeAt = (i: number) => onChange(opcoes.filter((_, j) => j !== i));
  const add = () => {
    if (opcoes.length >= 10) return;
    onChange([...opcoes, { id: novoIdOpcao(), titulo: "", acao: "texto", valor: "" }]);
  };
  return (
    <div className="space-y-2">
      {opcoes.map((o, i) => (
        <OpcaoEditor key={o.id} opcao={o} indice={i} nivel={nivel} pastas={pastas} onChange={(nova) => setAt(i, nova)} onRemove={() => removeAt(i)} />
      ))}
      {opcoes.length === 0 && (
        <p className="text-xs text-muted-foreground">{nivel === 0 ? "Nenhuma opção ainda." : "Nenhuma sub-opção ainda."}</p>
      )}
      {opcoes.length < 10 && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={add}>
          <Plus className="h-4 w-4" /> {nivel === 0 ? "Adicionar opção" : "Adicionar sub-opção"}
        </Button>
      )}
    </div>
  );
}

// Cutucada da opção: "sem resposta em X, mande isto". Desligada por padrão —
// bot que fala sozinho sem alguém ter pedido é o tipo de coisa que precisa ser
// escolhida, nunca herdada.
function RetomadaEditor({ opcao: o, onChange }: {
  opcao: WaMenuOpcao; onChange: (nova: WaMenuOpcao) => void;
}) {
  const r = o.retomada ?? null;
  const ligada = !!r;
  const minutos = r?.minutos ?? 60;

  const setR = (patch: Partial<{ minutos: number; mensagem: string }>) =>
    onChange({ ...o, retomada: { minutos, mensagem: r?.mensagem ?? "", ...patch } });

  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={ligada}
          onChange={(e) => onChange({ ...o, retomada: e.target.checked ? { minutos: 60, mensagem: "" } : null })}
        />
        <span className="text-xs font-semibold">Cutucar se não responder</span>
      </label>
      {ligada && (
        <div className="mt-2 space-y-2 pl-5">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">Esperar</Label>
            <Input
              type="number" min={1} max={RETOMADA_MAX_MIN} className="h-8 w-24 text-xs"
              value={minutos}
              onChange={(e) => setR({ minutos: Math.min(RETOMADA_MAX_MIN, Math.max(1, Number(e.target.value) || 1)) })}
            />
            <span className="text-xs text-muted-foreground">minutos ({fmtMinutos(minutos)})</span>
          </div>
          <Textarea
            rows={2} value={r?.mensagem ?? ""} onChange={(e) => setR({ mensagem: e.target.value })}
            placeholder="Ex.: Vi que você não respondeu. Ainda quer seguir com a candidatura?"
          />
          {!r?.mensagem?.trim() && (
            <p className="text-[11px] text-warning">Escreva a mensagem, senão a cutucada não é agendada.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Cancelada automaticamente se a pessoa responder ou se um atendente assumir.
            O máximo é {fmtMinutos(RETOMADA_MAX_MIN)}: acima disso a Meta bloqueia mensagem
            que não seja template.
          </p>
        </div>
      )}
    </div>
  );
}

// Imagem da resposta: colar (Ctrl+V), arrastar ou escolher arquivo. Sobe pro
// bucket na hora — guardar o arquivo dentro da config do menu (base64) faria
// o jsonb inchar e ser lido inteiro a cada mensagem que o bot responde.
function ImagemDaResposta({ opcao: o, onChange }: {
  opcao: WaMenuOpcao; onChange: (nova: WaMenuOpcao) => void;
}) {
  const { toast } = useToast();
  const [subindo, setSubindo] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // A prévia vem do bucket (a config guarda só o caminho).
  useEffect(() => {
    let vivo = true;
    if (!o.imagem?.storage_path) { setPrevia(null); return; }
    supabase.storage.from("whatsapp-midia").createSignedUrl(o.imagem.storage_path, 3600)
      .then(({ data }) => { if (vivo) setPrevia(data?.signedUrl ?? null); });
    return () => { vivo = false; };
  }, [o.imagem?.storage_path]);

  const subir = async (arquivo: File | null | undefined) => {
    if (!arquivo || subindo) return;
    if (!arquivo.type.startsWith("image/")) {
      toast({ title: "Só imagem", description: "O bot envia imagem nesta opção; para documento, use um link na resposta.", variant: "destructive" });
      return;
    }
    if (arquivo.size > 5 * 1024 * 1024) {
      toast({ title: "Imagem grande demais", description: "O WhatsApp aceita até 5 MB.", variant: "destructive" });
      return;
    }
    setSubindo(true);
    const caminho = `saida/chatbot/${novoUuid()}-${arquivo.name || "colada.png"}`;
    const { error } = await supabase.storage.from("whatsapp-midia")
      .upload(caminho, arquivo, { contentType: arquivo.type });
    setSubindo(false);
    if (error) { toast({ title: "Não deu para subir", description: error.message, variant: "destructive" }); return; }
    onChange({ ...o, imagem: { storage_path: caminho, mime_type: arquivo.type, filename: arquivo.name } });
    toast({ title: "Imagem anexada", description: "Salve a configuração para valer." });
  };

  return (
    <div
      className="rounded border border-border/60 bg-muted/20 p-2"
      onPaste={(e) => { const f = Array.from(e.clipboardData.files)[0]; if (f) { e.preventDefault(); subir(f); } }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); subir(e.dataTransfer.files?.[0]); }}
      tabIndex={0}
    >
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">Imagem da resposta</span>
        <span className="text-[11px] text-muted-foreground">(opcional)</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {previa && <img src={previa} alt="" className="h-16 w-16 rounded object-cover" />}
        <input ref={input} type="file" accept="image/*" className="hidden"
          onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ""; }} />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => input.current?.click()} disabled={subindo}>
          <ImageIcon className="h-4 w-4" /> {subindo ? "Subindo…" : o.imagem ? "Trocar imagem" : "Escolher imagem"}
        </Button>
        {o.imagem && (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive"
            onClick={() => onChange({ ...o, imagem: null })}>
            Remover
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Clique aqui e use <b>Ctrl+V</b> para colar um print, ou arraste o arquivo.
        A imagem vai junto com o texto acima: o texto vira a legenda.
      </p>
    </div>
  );
}

function OpcaoEditor({ opcao: o, indice, nivel, pastas, onChange, onRemove }: {
  opcao: WaMenuOpcao; indice: number; nivel: number; pastas: WaPasta[];
  onChange: (nova: WaMenuOpcao) => void; onRemove: () => void;
}) {
  const ajuda = MENU_ACOES.find((a) => a.value === o.acao)?.ajuda ?? "";
  const sub: WaMenu = o.submenu ?? { titulo: "", opcoes: [] };
  return (
    <div className={`space-y-2 rounded border border-border/60 p-2.5 ${nivel > 0 ? "bg-muted/30" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-muted-foreground">{indice + 1}</span>
        <Input className="h-8 flex-1 text-sm" maxLength={20} placeholder="Título do botão (ex.: Vagas Disponíveis)" value={o.titulo} onChange={(e) => onChange({ ...o, titulo: e.target.value })} />
        <Select value={o.acao} onValueChange={(v) => onChange({ ...o, acao: v as WaMenuAcao })}>
          <SelectTrigger className="h-8 w-48 shrink-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MENU_ACOES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      </div>
      {/* Para onde a conversa vai. Sem pasta escolhida a opção viraria um buraco
          (bot desligado, ninguém dono), então o bot trata como atendente comum e
          a tela avisa aqui. */}
      {o.acao === "transferir" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs font-semibold">Transferir para:</Label>
          <Select value={o.pasta ?? ""} onValueChange={(v) => onChange({ ...o, pasta: v })}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Escolha a pasta…" /></SelectTrigger>
            <SelectContent>
              {pastas.map((p) => <SelectItem key={p.codigo} value={p.codigo}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {!o.pasta && <span className="text-[11px] text-warning">Escolha uma pasta, senão a conversa fica sem fila.</span>}
        </div>
      )}
      {o.acao !== "submenu" && (
        <Textarea
          rows={2}
          value={o.valor ?? ""}
          onChange={(e) => onChange({ ...o, valor: e.target.value })}
          placeholder={
            o.acao === "texto" ? "Resposta que o bot envia ao escolher esta opção"
            : o.acao === "humano" ? "Aviso ao cliente (ex.: Um atendente vai te responder em instantes)"
            : o.acao === "transferir" ? "Aviso ao cliente ao ser transferido. Pode deixar em branco."
            : o.acao === "concluir" ? "Despedida ao encerrar (ex.: Atendimento encerrado, obrigado!). Pode deixar em branco."
            : "Aviso ao entrar na IA (ex.: Perfeito! Me conta como posso te ajudar). Pode deixar em branco."
          }
        />
      )}
      <p className="text-[11px] text-muted-foreground">{ajuda}</p>
      {/* Cutucada desta opção. Fica por opção porque o assunto muda a cada
          ponto do fluxo: quem não respondeu sobre vaga precisa de um lembrete
          diferente de quem não respondeu sobre documento. */}
      {o.acao === "texto" && <ImagemDaResposta opcao={o} onChange={onChange} />}
      {o.acao !== "submenu" && <RetomadaEditor opcao={o} onChange={onChange} />}
      {o.acao === "submenu" && (
        <div className="ml-4 space-y-2 border-l-2 border-primary/25 pl-3">
          <div>
            <Label className="mb-1.5 block text-xs font-semibold">Mensagem deste submenu</Label>
            <Textarea rows={2} value={sub.titulo} onChange={(e) => onChange({ ...o, submenu: { ...sub, titulo: e.target.value } })}
              placeholder={`Ex.: ${o.titulo.trim() || "…"} — selecione uma opção:`} />
          </div>
          <OpcoesEditor opcoes={sub.opcoes} nivel={nivel + 1} pastas={pastas} onChange={(ops) => onChange({ ...o, submenu: { ...sub, opcoes: ops } })} />
        </div>
      )}
      {/* Botões DA RESPOSTA. A resposta e os botões saem numa mensagem só (o
          texto vira o corpo), e cada botão é uma opção comum — então a resposta
          dele também pode ter botões, sem limite de profundidade. */}
      {o.acao === "texto" && (
        <div className="ml-4 space-y-2 border-l-2 border-success/30 pl-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-semibold">Botões desta resposta <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            {sub.opcoes.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{sub.opcoes.length <= 3 ? "vira botões" : "vira lista"}</span>
            )}
          </div>
          {sub.opcoes.length === 0 ? (
            <Button size="sm" variant="outline" className="gap-1.5"
              onClick={() => onChange({ ...o, submenu: { titulo: "", opcoes: [{ id: novoIdOpcao(), titulo: "", acao: "texto", valor: "" }] } })}>
              <Plus className="h-4 w-4" /> Adicionar botão à resposta
            </Button>
          ) : (
            <OpcoesEditor opcoes={sub.opcoes} nivel={nivel + 1} pastas={pastas}
              onChange={(ops) => onChange({ ...o, submenu: { ...sub, opcoes: ops } })} />
          )}
        </div>
      )}
    </div>
  );
}

// Perfil do NOSSO número — é o que o contato vê ao abrir a conversa. Não tem
// nada a ver com a foto dos contatos: a Cloud API não expõe avatar de usuário
// (só o profile.name), então do outro lado continuam as iniciais.
// "Não informar" precisa de um valor sentinela: o Radix Select reserva a string
// vazia para "sem seleção" e lança exceção se um item usar ela — o que derruba
// a página inteira (tela branca). Vira "" de novo na hora de enviar à Meta.
const SEM_RAMO = "__sem_ramo";
const VERTICAIS: Array<{ v: string; l: string }> = [
  { v: SEM_RAMO, l: "Não informar" },
  { v: "PROF_SERVICES", l: "Serviços profissionais" },
  { v: "OTHER", l: "Outro" },
  { v: "EDU", l: "Educação" },
  { v: "HEALTH", l: "Saúde" },
  { v: "FINANCE", l: "Financeiro" },
  { v: "GOVT", l: "Governo" },
  { v: "NONPROFIT", l: "Sem fins lucrativos" },
  { v: "RETAIL", l: "Varejo" },
  { v: "NOT_A_BIZ", l: "Não é empresa" },
];

interface PerfilNegocio {
  about?: string; description?: string; address?: string; email?: string;
  vertical?: string; websites?: string[]; profile_picture_url?: string;
}

/**
 * A Meta só aceita foto de perfil em JPG quadrado, até 640px de lado. Recusar
 * PNG obrigaria a pessoa a sair do ERP e converter a imagem à mão, então o
 * navegador faz isso: recorta o centro no quadrado e exporta em JPEG 640x640.
 */
async function prepararFotoPerfil(arquivo: File): Promise<File> {
  const bitmap = await createImageBitmap(arquivo);
  const lado = Math.min(bitmap.width, bitmap.height);   // recorte quadrado central
  const dx = (bitmap.width - lado) / 2;
  const dy = (bitmap.height - lado) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar a imagem neste navegador.");
  // JPEG não tem transparência: fundo branco evita PNG transparente virar preto.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 640);
  ctx.drawImage(bitmap, dx, dy, lado, lado, 0, 0, 640, 640);

  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new Error("Não consegui converter a imagem para JPG.");
  return new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function PerfilNegocioCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rascunho, setRascunho] = useState<PerfilNegocio | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: perfil, isLoading } = useQuery({
    queryKey: ["wa-perfil-negocio"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-perfil", { body: { acao: "ler" } });
      if (error) throw error;
      return (data as any)?.perfil as PerfilNegocio;
    },
  });

  const p = rascunho ?? perfil ?? {};
  const set = (k: keyof PerfilNegocio, v: any) => setRascunho({ ...p, [k]: v });

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      let fotoRef: { storage_path: string; mime_type: string } | undefined;
      if (foto) {
        // Converte pro formato que a Meta aceita ANTES de subir: PNG, imagem
        // retangular ou gigante entrariam e só falhariam lá na frente.
        const jpg = await prepararFotoPerfil(foto);
        // Mesmo caminho dos anexos: sobe pro bucket e manda só o caminho.
        const caminho = `saida/perfil/${novoUuid()}-${jpg.name}`;
        const { error: erroUp } = await supabase.storage.from("whatsapp-midia")
          .upload(caminho, jpg, { contentType: "image/jpeg" });
        if (erroUp) throw new Error(`Falha ao subir a imagem: ${erroUp.message}`);
        fotoRef = { storage_path: caminho, mime_type: "image/jpeg" };
      }
      const { data, error } = await supabase.functions.invoke("whatsapp-perfil", {
        body: { acao: "salvar", perfil: p, ...(fotoRef ? { foto: fotoRef } : {}) },
      });
      if (error) throw new Error(await erroDaFunction(error));
      if ((data as any)?.error) throw new Error(String((data as any).error));
      setRascunho(null);
      setFoto(null);
      qc.invalidateQueries({ queryKey: ["wa-perfil-negocio"] });
      toast({ title: "Perfil atualizado", description: "Os contatos já veem as mudanças." });
    } catch (e: any) {
      toast({ title: "Não deu para salvar", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold"><Bot className="h-4 w-4 text-primary" /> Perfil do nosso WhatsApp</p>
        <p className="text-xs text-muted-foreground">
          O que a pessoa vê ao abrir a conversa com o número da empresa.
        </p>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Carregando o perfil…</p>}

      <div className="flex flex-wrap items-center gap-3">
        {perfil?.profile_picture_url
          ? <img src={perfil.profile_picture_url} alt="" className="h-16 w-16 rounded-full object-cover" />
          : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">sem foto</div>}
        <div>
          <Input
            type="file" accept="image/*" className="h-8 w-64 text-xs"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Pode ser PNG ou JPG: a imagem é recortada no quadrado e convertida pra JPG 640×640 automaticamente.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold">Recado (aparece abaixo do nome)</Label>
          <Input className="h-8 text-sm" maxLength={139} value={p.about ?? ""} onChange={(e) => set("about", e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">E-mail</Label>
          <Input className="h-8 text-sm" maxLength={128} value={p.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-1 block text-xs font-semibold">Descrição</Label>
          <Textarea rows={2} maxLength={512} value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Endereço</Label>
          <Input className="h-8 text-sm" maxLength={256} value={p.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Ramo</Label>
          <Select
            value={p.vertical || SEM_RAMO}
            onValueChange={(v) => set("vertical", v === SEM_RAMO ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha…" /></SelectTrigger>
            <SelectContent>
              {VERTICAIS.map((v) => <SelectItem key={v.v} value={v.v}>{v.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-1 block text-xs font-semibold">Sites <span className="font-normal text-muted-foreground">(até 2)</span></Label>
          <div className="flex flex-wrap gap-2">
            {[0, 1].map((i) => (
              <Input
                key={i} className="h-8 flex-1 text-sm" placeholder="https://…"
                value={p.websites?.[i] ?? ""}
                onChange={(e) => {
                  const atuais = [...(p.websites ?? [])];
                  atuais[i] = e.target.value;
                  set("websites", atuais);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={salvar} disabled={salvando}>
          <Save className="h-4 w-4" /> {salvando ? "Salvando…" : "Salvar perfil"}
        </Button>
      </div>
    </Card>
  );
}

// Pastas de atendimento. Criar uma pasta cria junto a permissão que a governa
// (uma linha em app_menu sob o WhatsApp), então ela já aparece na cascata de
// Administração › Acesso por Usuário — não existe tela de permissão aqui.
function PastasCard({ pastas }: { pastas: WaPasta[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [nova, setNova] = useState("");
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    const nome = nova.trim();
    if (!nome || salvando) return;
    setSalvando(true);
    const { error } = await (supabase as any).rpc("wa_pasta_criar", { _nome: nome });
    setSalvando(false);
    if (error) { toast({ title: "Não deu para criar", description: error.message, variant: "destructive" }); return; }
    setNova("");
    qc.invalidateQueries({ queryKey: ["wa-pastas"] });
    toast({ title: "Pasta criada", description: `Libere quem enxerga "${nome}" em Administração › Acesso por Usuário.` });
  };

  const remover = async (p: WaPasta) => {
    if (!confirm(`Remover a pasta "${p.nome}"? As conversas dela voltam para a triagem e a permissão é apagada.`)) return;
    const { error } = await (supabase as any).rpc("wa_pasta_remover", { _codigo: p.codigo });
    if (error) { toast({ title: "Não deu para remover", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-pastas"] });
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold"><FolderTree className="h-4 w-4 text-primary" /> Pastas de atendimento</p>
        <p className="text-xs text-muted-foreground">
          Filas por setor. A opção <b>Transferir para…</b> do menu joga a conversa numa pasta e desliga o bot;
          só quem tem acesso àquela pasta enxerga a conversa. Quem vê o quê é liberado em{" "}
          <b>Administração › Acesso por Usuário</b>, na cascata abaixo do WhatsApp.
        </p>
      </div>
      <div className="space-y-1.5">
        {pastas.map((p) => (
          <div key={p.codigo} className="flex items-center gap-2 rounded border border-border/60 px-2.5 py-1.5">
            <span className="flex-1 text-sm font-medium">{p.nome}</span>
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.menu_codigo}</code>
            <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive" onClick={() => remover(p)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {pastas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma pasta ainda.</p>}
      </div>
      <div className="flex items-center gap-2">
        <Input className="h-8 flex-1 text-sm" placeholder="Nome da nova pasta (ex.: Financeiro)" value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criar(); } }} />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={criar} disabled={!nova.trim() || salvando}>
          <Plus className="h-4 w-4" /> Criar pasta
        </Button>
      </div>
    </Card>
  );
}

export default function WhatsAppChatbot() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeEditar = access?.codes.has("whatsapp_chatbot") ?? false;

  const [cfg, setCfg] = useState<WaBotConfig | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoConteudo, setNovoConteudo] = useState("");

  const { data: configDb } = useQuery({
    queryKey: ["wa-bot-config"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
      return (data ?? null) as WaBotConfig | null;
    },
  });
  useEffect(() => { if (configDb && !cfg) setCfg(configDb); }, [configDb]); // eslint-disable-line

  const { data: base = [] } = useQuery({
    queryKey: ["wa-bot-conhecimento"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_BOT_CONHECIMENTO").select("*").order("ordem");
      return (data ?? []) as WaConhecimento[];
    },
  });

  // Pastas de atendimento — alimentam a ação "Transferir para…" e o card de
  // gestão. Quem vê cada pasta é decidido em Administração › Acesso por Usuário.
  const { data: pastas = [] } = useQuery({
    queryKey: ["wa-pastas"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_PASTA").select("*").eq("ativo", true).order("ordem");
      return (data ?? []) as WaPasta[];
    },
  });

  const set = <K extends keyof WaBotConfig>(k: K, v: WaBotConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  // Provedor de IA. Trocar o provedor troca a lista de modelos, então o modelo
  // atual (de outro provedor) é substituído pelo primeiro da nova lista.
  const provedor: WaProvedor = cfg?.provedor ?? "groq";
  const modelos = MODELOS[provedor] ?? MODELOS.groq;
  const provedorMeta = PROVEDORES.find((p) => p.value === provedor);
  const trocarProvedor = (v: WaProvedor) =>
    setCfg((c) => (c ? { ...c, provedor: v, modelo: MODELOS[v][0].value } : c));

  // Menu de atendimento — é o fluxo único do bot: toda conversa começa aqui.
  const menu: WaMenu = cfg?.menu ?? { titulo: "", opcoes: [] };
  const setMenu = (m: WaMenu) => set("menu", m);

  const salvar = async () => {
    if (!cfg || salvando) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("WA_BOT_CONFIG").update({
      ativo: cfg.ativo, persona: cfg.persona, fallback: cfg.fallback,
      horario_inicio: cfg.horario_inicio, horario_fim: cfg.horario_fim, dias_semana: cfg.dias_semana,
      fora_horario_msg: cfg.fora_horario_msg, atende_24h: cfg.atende_24h ?? false,
      nao_repetir_menu_min: cfg.nao_repetir_menu_min ?? 0,
      provedor: cfg.provedor, modelo: cfg.modelo, max_tokens: cfg.max_tokens,
      menu: { titulo: menu.titulo, opcoes: menu.opcoes },
    }).eq("id", true);
    setSalvando(false);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Configuração salva" });
    qc.invalidateQueries({ queryKey: ["wa-bot-config"] });
  };

  const alternarAtivo = async () => {
    if (!cfg) return;
    const novo = !cfg.ativo;
    set("ativo", novo);
    const { error } = await (supabase as any).from("WA_BOT_CONFIG").update({ ativo: novo }).eq("id", true);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); set("ativo", !novo); return; }
    qc.invalidateQueries({ queryKey: ["wa-bot-config"] });
  };

  const addConhecimento = async () => {
    if (!novoTitulo.trim() || !novoConteudo.trim()) return;
    const { error } = await (supabase as any).from("WA_BOT_CONHECIMENTO").insert({
      titulo: novoTitulo.trim(), conteudo: novoConteudo.trim(), ordem: base.length + 1,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setNovoTitulo(""); setNovoConteudo("");
    qc.invalidateQueries({ queryKey: ["wa-bot-conhecimento"] });
  };

  const removerConhecimento = async (id: string) => {
    await (supabase as any).from("WA_BOT_CONHECIMENTO").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["wa-bot-conhecimento"] });
  };

  const toggleDia = (d: number) => {
    if (!cfg) return;
    const tem = cfg.dias_semana.includes(d);
    set("dias_semana", tem ? cfg.dias_semana.filter((x) => x !== d) : [...cfg.dias_semana, d].sort());
  };

  if (!podeEditar) {
    return (
      <div>
        <PageHeader title="WhatsApp — Chatbot" module="Central de Serviços" breadcrumb={["WhatsApp", "Chatbot"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Chatbot</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }
  if (!cfg) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div>
      <PageHeader
        title="WhatsApp — Chatbot"
        subtitle="Toda conversa começa pelo menu de atendimento. Configure as opções, a IA e os horários."
        module="Central de Serviços"
        breadcrumb={["WhatsApp", "Chatbot"]}
        actions={<Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp")}><Inbox className="h-4 w-4" /> Caixa de Entrada</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Estado do bot */}
          <Card className={`flex items-center justify-between gap-3 p-4 ${cfg.ativo ? "border-success/30 bg-success/5" : ""}`}>
            <div className="flex items-center gap-2.5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cfg.ativo ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}><Bot className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-bold">Chatbot {cfg.ativo ? "ativo" : "desligado"}</p>
                <p className="text-xs text-muted-foreground">{cfg.ativo ? "Responde automaticamente dentro do horário." : "Nenhuma resposta automática será enviada."}</p>
              </div>
            </div>
            <Button variant={cfg.ativo ? "outline" : "default"} className="gap-1.5" onClick={alternarAtivo}>
              <Power className="h-4 w-4" /> {cfg.ativo ? "Desligar" : "Ligar"}
            </Button>
          </Card>

          {/* Menu de atendimento — o fluxo único do bot */}
          <Card className="space-y-3 p-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold"><MousePointerClick className="h-4 w-4 text-primary" /> Menu de atendimento</p>
              <p className="text-xs text-muted-foreground">
                Toda conversa começa aqui: o bot manda esta mensagem com os botões e <b>só responde o que estiver configurado</b>.
                Uma opção pode responder um texto, abrir mais opções (cascata), transferir para a pasta de um setor,
                encaminhar pra IA ou pra um atendente. <b>Toda resposta pode terminar com botões</b>, e a resposta
                desses botões também — sem limite de profundidade. Em cada nível, até 3 opções viram botões; 4–10 viram lista.
              </p>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Mensagem de abertura</Label>
              <Textarea rows={2} value={menu.titulo} onChange={(e) => setMenu({ ...menu, titulo: e.target.value })} placeholder="Ex.: Olá! Somos da Empresa Nascimento. Selecione a opção desejada:" />
            </div>
            <OpcoesEditor opcoes={menu.opcoes} nivel={0} pastas={pastas} onChange={(ops) => setMenu({ ...menu, opcoes: ops })} />
            {menu.opcoes.length === 0 ? (
              <p className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
                Sem opções configuradas o bot <b>não responde nada</b> — nem a IA. Adicione ao menos uma opção.
              </p>
            ) : !temOpcaoIA(menu.opcoes) && (
              <p className="text-[11px] text-muted-foreground">
                Nenhuma opção leva à IA — quem escrever fora dos botões recebe o menu de novo. A IA só atende se você criar uma opção de <b>Atendimento por I.A</b>.
              </p>
            )}
          </Card>

          <PastasCard pastas={pastas} />

          <PerfilNegocioCard />


          {/* Comportamento da IA (usado pela opção de atendimento por IA) */}
          <Card className="space-y-4 p-4">
            <div>
              <p className="text-sm font-bold">Atendimento por I.A</p>
              <p className="text-xs text-muted-foreground">Vale quando um botão encaminha para a IA: a partir daí a pessoa conversa livre e a IA responde.</p>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Persona / instruções do sistema</Label>
              <Textarea rows={5} value={cfg.persona} onChange={(e) => set("persona", e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Define o tom e as regras. A base de conhecimento abaixo é injetada junto.</p>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Mensagem de fallback</Label>
              <Textarea rows={2} value={cfg.fallback} onChange={(e) => set("fallback", e.target.value)} placeholder="Enviada quando a IA não conseguir responder" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Provedor de IA</Label>
                <Select value={provedor} onValueChange={(v) => trocarProvedor(v as WaProvedor)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVEDORES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Modelo</Label>
                <Select value={cfg.modelo} onValueChange={(v) => set("modelo", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modelos.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Máx. de tokens por resposta</Label>
                <Input type="number" min={128} max={4096} value={cfg.max_tokens} onChange={(e) => set("max_tokens", Number(e.target.value) || 1024)} />
              </div>
            </div>
            {provedorMeta && (
              <p className="text-[11px] text-muted-foreground">
                {provedorMeta.ajuda} Guarde a chave no secret <code className="rounded bg-muted px-1.5">{provedorMeta.secret}</code>.
              </p>
            )}
          </Card>

          {/* Base de conhecimento */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Base de conhecimento <span className="font-normal text-muted-foreground">({base.length})</span></p>
            <p className="text-xs text-muted-foreground">Blocos de FAQ/contexto que a IA usa para responder (vagas, procedimentos, políticas…).</p>
            <div className="space-y-2">
              {base.map((k) => (
                <div key={k.id} className="flex items-start gap-2 rounded border border-border/60 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{k.titulo}</p>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">{k.conteudo}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removerConhecimento(k.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {base.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item ainda.</p>}
            </div>
            <div className="space-y-2 rounded border border-dashed border-border p-2.5">
              <Input placeholder="Título (ex.: Vagas disponíveis)" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} />
              <Textarea rows={2} placeholder="Conteúdo…" value={novoConteudo} onChange={(e) => setNovoConteudo(e.target.value)} />
              <Button size="sm" className="gap-1.5" onClick={addConhecimento} disabled={!novoTitulo.trim() || !novoConteudo.trim()}><Plus className="h-4 w-4" /> Adicionar</Button>
            </div>
          </Card>

          {/* Horário */}
          <Card className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-bold">Horário de atendimento do bot</p>
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox" className="h-4 w-4 accent-primary"
                  checked={cfg.atende_24h ?? false}
                  onChange={(e) => set("atende_24h", e.target.checked)}
                />
                Atender 24h, todos os dias
              </label>
            </div>

            {cfg.atende_24h ? (
              <p className="rounded border border-success/30 bg-success/5 px-3 py-2 text-xs text-muted-foreground">
                O bot responde a qualquer hora, em qualquer dia. A faixa de horário e a mensagem de fora do
                expediente ficam sem efeito enquanto esta opção estiver ligada.
              </p>
            ) : (
              <>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label className="mb-1.5 block text-xs font-semibold">Início</Label>
                  <Input type="time" className="w-32" value={cfg.horario_inicio?.slice(0, 5)} onChange={(e) => set("horario_inicio", e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-semibold">Fim</Label>
                  <Input type="time" className="w-32" value={cfg.horario_fim?.slice(0, 5)} onChange={(e) => set("horario_fim", e.target.value)} />
                </div>
                <div className="min-w-0">
                  <Label className="mb-1.5 block text-xs font-semibold">Dias</Label>
                  <div className="flex flex-wrap gap-1">
                    {DIAS.map((d) => (
                      <button key={d.v} type="button" onClick={() => toggleDia(d.v)}
                        className={`rounded-md border px-2 py-1 text-xs ${cfg.dias_semana.includes(d.v) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                        {d.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Mensagem fora do horário</Label>
                <Textarea rows={2} value={cfg.fora_horario_msg} onChange={(e) => set("fora_horario_msg", e.target.value)} />
              </div>
              </>
            )}
          </Card>

          {/* Anti-repetição. O bot reapresentava o menu a cada texto solto, então
              quem escrevia três vezes recebia a saudação três vezes. */}
          <Card className="space-y-2 p-4">
            <p className="text-sm font-bold">Não repetir o menu</p>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs">Depois de apresentar o menu, não repetir por</Label>
              <Input
                type="number" min={0} className="h-8 w-24 text-xs"
                value={cfg.nao_repetir_menu_min ?? 0}
                onChange={(e) => set("nao_repetir_menu_min", Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="text-xs text-muted-foreground">
                minutos {(cfg.nao_repetir_menu_min ?? 0) > 0 ? `(${fmtMinutos(cfg.nao_repetir_menu_min)})` : ""}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dentro desse tempo, texto solto não faz o bot reapresentar a saudação — ele fica quieto.
              Clicar num botão e digitar <b>menu</b> continuam funcionando sempre. <b>0</b> volta ao
              comportamento antigo (repete toda vez).
            </p>
          </Card>

          <div className="flex justify-end">
            <Button className="gap-1.5" onClick={salvar} disabled={salvando}><Save className="h-4 w-4" /> {salvando ? "Salvando…" : "Salvar configuração"}</Button>
          </div>
        </div>

        {/* Setup lateral */}
        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Info className="h-4 w-4 text-info" /> Integração com a Meta</p>
            <p className="text-xs text-muted-foreground">No app do WhatsApp na Meta (Cloud API), configure o webhook:</p>
            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Callback URL</Label>
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-[11px]">{WEBHOOK_URL}</code>
            </div>
            <p className="text-xs text-muted-foreground">O <b>Verify token</b> deve ser igual ao secret <code>WHATSAPP_VERIFY_TOKEN</code>. Inscreva o campo <code>messages</code>.</p>
            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Secrets (Supabase → Edge Functions)</Label>
              <ul className="space-y-0.5">
                {[...SECRETS_META, ...(provedorMeta ? [provedorMeta.secret] : [])].map((s) => (
                  <li key={s} className="flex items-center gap-1.5 text-[11px]"><code className="rounded bg-muted px-1.5">{s}</code></li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground">As Edge Functions <code>whatsapp-webhook</code> e <code>whatsapp-enviar</code> precisam estar deployadas.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
