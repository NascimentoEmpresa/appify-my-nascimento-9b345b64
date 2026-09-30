import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Copy, ExternalLink, Eye, Megaphone, MoreVertical, Pencil, Plus, Trash2, Users } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import {
  urlPublicaCampanha, useTrnCampanhas, useTrnDuplicarCampanha, useTrnExcluirCampanha, useTrnPublicarCampanha,
  type CampanhaLista,
} from "@/hooks/useTrnCampanhas";
import { MENU } from "./tipos";
import { BotaoQrCode } from "./QrCodeDialog";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio, fmtData } from "./ui";

// =====================================================================
// TREINAMENTOS › Campanhas (30/09/2026) — lista.
//
// Campanha = página PÚBLICA (sem login) em /campanhas/<slug> com vídeos,
// textos, imagens, links, arquivos e provinhas. Cada card tem o "Gerar QR
// Code" do endereço público; o QR de cada vídeo fica no editor.
// =====================================================================

type Situacao = "no_ar" | "rascunho" | "agendada" | "encerrada";
const situacao = (c: CampanhaLista): Situacao => {
  if (!c.publicada) return "rascunho";
  const agora = Date.now();
  if (c.inicio_em && new Date(c.inicio_em).getTime() > agora) return "agendada";
  if (c.fim_em && new Date(c.fim_em).getTime() < agora) return "encerrada";
  return "no_ar";
};
const ROTULO_SITUACAO: Record<Situacao, [string, string]> = {
  no_ar: ["No ar", "ok"], rascunho: ["Rascunho", "off"], agendada: ["Agendada", "info"], encerrada: ["Encerrada", "warn"],
};

export default function CampanhasLista() {
  const navigate = useNavigate();
  const { data = [], isLoading, error } = useTrnCampanhas();
  const excluir = useTrnExcluirCampanha();
  const duplicar = useTrnDuplicarCampanha();
  const publicar = useTrnPublicarCampanha();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | Situacao>("todas");

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return data.filter((c) => (filtro === "todas" || situacao(c) === filtro) && (!b || c.titulo.toLowerCase().includes(b) || c.slug.includes(b)));
  }, [data, busca, filtro]);

  const noAr = data.filter((c) => situacao(c) === "no_ar").length;
  const acessos = data.reduce((s, c) => s + c.acessos, 0);
  const respostas = data.reduce((s, c) => s + c.respostas, 0);

  const copiar = async (c: CampanhaLista) => {
    try { await navigator.clipboard.writeText(urlPublicaCampanha(c.slug)); toast.success("Link público copiado."); } catch { toast.error("Não deu para copiar."); }
  };
  const apagar = async (c: CampanhaLista) => {
    if (!window.confirm(`Excluir a campanha "${c.titulo}"? O link e os QR Codes impressos param de funcionar, e as ${c.respostas} resposta(s) somem junto.`)) return;
    try { await excluir.mutateAsync(c.id); toast.success("Campanha excluída."); } catch (e: any) { toast.error(e?.message ?? "Não deu para excluir."); }
  };
  const copiarCampanha = async (c: CampanhaLista) => {
    try { const id = await duplicar.mutateAsync(c.id); toast.success("Cópia criada como rascunho."); navigate(`/app/treinamentos/campanhas/${id}`); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para duplicar."); }
  };
  const alternar = async (c: CampanhaLista) => {
    try { await publicar.mutateAsync({ id: c.id, publicada: !c.publicada }); toast.success(c.publicada ? "Campanha tirada do ar." : "Campanha publicada."); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.campanhas} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as campanhas.</Card>}>
        <TrnHero eyebrow="Treinamentos" titulo="Campanhas"
                 texto="Páginas públicas, sem login, com vídeos, textos, imagens, links, arquivos e provinhas. Cada campanha tem um link próprio e um QR Code para cartaz, crachá ou grupo."
                 pilulas={[`${noAr} no ar`, `${acessos} acesso(s)`, `${respostas} resposta(s) de provinha`]}
                 acoes={<AcessoGate menu={MENU.campanhas} acao="incluir"><Link to="/app/treinamentos/campanhas/nova"><Plus className="h-4 w-4" /> Nova campanha</Link></AcessoGate>} />

        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Buscar campanha…" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs bg-white" />
          <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
            <SelectTrigger className="w-44 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_SITUACAO[s][0]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? <TrnCarregando /> : error ? (
          <Card className="p-6 text-sm text-rose-600">Não deu para carregar as campanhas: {(error as Error).message}</Card>
        ) : data.length === 0 ? (
          <TrnVazio titulo="Nenhuma campanha ainda" texto="Crie a primeira: título, capa e o conteúdo — vídeos, textos, provinhas. Ao salvar, sai o link público e o QR Code."
                    acao={<AcessoGate menu={MENU.campanhas} acao="incluir"><Button asChild><Link to="/app/treinamentos/campanhas/nova">Nova campanha</Link></Button></AcessoGate>} />
        ) : lista.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nenhuma campanha com esse filtro.</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((c) => {
              const capa = urlMidia(c.capa_path);
              const [rot, cls] = ROTULO_SITUACAO[situacao(c)];
              return (
                <div key={c.id} className="trn-curso-card">
                  <Link to={`/app/treinamentos/campanhas/${c.id}`} className="capa" style={{ background: capa ? undefined : `linear-gradient(135deg, ${c.cor}, ${c.cor}bb)` }}>
                    {capa ? <img src={capa} alt={c.titulo} /> : c.titulo}
                  </Link>
                  <div className="corpo">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`trn-badge ${cls}`}>{rot}</span>
                      <span className="trn-badge off">{c.itens} conteúdo(s)</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="ml-auto h-7 w-7"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/campanhas/${c.id}`)}><Pencil className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/campanhas/${c.id}?aba=respostas`)}><Users className="mr-2 h-4 w-4" /> Respostas e acessos</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => copiar(c)}><Copy className="mr-2 h-4 w-4" /> Copiar link público</DropdownMenuItem>
                          <AcessoGate menu={MENU.campanhas} acao="alterar">
                            <DropdownMenuItem onSelect={() => alternar(c)}><Eye className="mr-2 h-4 w-4" /> {c.publicada ? "Tirar do ar" : "Publicar"}</DropdownMenuItem>
                          </AcessoGate>
                          <AcessoGate menu={MENU.campanhas} acao="incluir">
                            <DropdownMenuItem onSelect={() => copiarCampanha(c)}><Megaphone className="mr-2 h-4 w-4" /> Duplicar</DropdownMenuItem>
                          </AcessoGate>
                          <AcessoGate menu={MENU.campanhas} acao="excluir">
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(c)}><Trash2 className="mr-2 h-4 w-4" /> Excluir</DropdownMenuItem>
                          </AcessoGate>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <Link to={`/app/treinamentos/campanhas/${c.id}`}><h3 className="hover:underline">{c.titulo}</h3></Link>
                    <p>{c.resumo || "Sem resumo."}</p>
                    <div className="truncate font-mono text-[11px] text-slate-400" title={urlPublicaCampanha(c.slug)}>/campanhas/{c.slug}</div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{c.acessos} acesso(s)</span><span>{c.respostas} resposta(s)</span>
                      <span className="ml-auto">{c.fim_em ? `até ${fmtData(c.fim_em)}` : `criada ${fmtData(c.created_at)}`}</span>
                    </div>
                    <div className="mt-auto flex gap-2 pt-2">
                      <BotaoQrCode url={urlPublicaCampanha(c.slug)} titulo={c.titulo} rotulo="GERAR QR CODE" className="flex-1"
                                   aviso={situacao(c) !== "no_ar" ? "A campanha não está no ar — quem ler o QR agora vê \"Campanha indisponível\". Publique para liberar." : undefined} />
                      <Button variant="outline" size="sm" asChild title="Abrir página pública">
                        <a href={urlPublicaCampanha(c.slug)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
