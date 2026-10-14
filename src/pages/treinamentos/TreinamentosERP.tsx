import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GraduationCap, Video, Paperclip, ListChecks, Plus, Search, Pencil, Trash2,
  CheckCircle2, EyeOff, PlayCircle, Loader2, Award, BarChart3, Lock, RotateCcw, Tag, Boxes,
  AlertTriangle, MonitorCog,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertasTreinamento, useAlertasTreinamento, usePodeVerAlertasTreinamento } from "@/components/treinamentos/AlertasTreinamento";
import { MODULOS_ERP, labelDe } from "@/pages/chamados/types";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { TreinamentoEditor } from "./treinamento/TreinamentoEditor";
import { TreinamentoVisor } from "./treinamento/TreinamentoVisor";
import { DashboardVideos } from "./treinamento/DashboardVideos";
import { recursosDe, type EscopoTreinamento, type Treinamento } from "./treinamento/core";
import { ROTA_TREINAMENTOS_SISTEMAS, useTreinamentosSistemas } from "./TreinamentosSistemas";
import { ReacoesVideoMini } from "@/components/treinamentos/ReacoesVideo";
import { useNumerosTreinamentos } from "@/hooks/useVideoNumeros";

// =====================================================================
// TREINAMENTOS — a grade de cards.
//
// A MESMA tela serve os dois módulos, e cada um tem a SUA grade: o `escopo`
// diz de qual porta a pessoa entrou (Encarregados ou Central de Serviços) e
// a consulta traz só os treinamentos daquele módulo. Um treinamento marcado
// nos dois aparece nas duas grades — é uma linha só, com uma prova e um
// histórico de conclusão.
//
// Quem pode gerenciar (menu `treinamentos_gerenciar`) cria e edita; quem
// enxerga o menu do módulo assiste. Quem decide de verdade é a RLS
// (`trn_pode_ver_escopos`) — o `podeGerenciar` daqui só evita mostrar botão
// que o banco recusaria, e o filtro por escopo abaixo é conveniência: a
// policy já recorta a mesma coisa.
// =====================================================================

interface Conclusao {
  treinamento_id: string;
  prova_nota: number | null;
  aprovado: boolean | null;
}

/** Situação da pessoa na prova (TREINAMENTO_PROVA_ESTADO, mig 20261014000020). */
interface EstadoCard {
  treinamento_id: string;
  falhas_seguidas: number;
  bloqueado: boolean;
}

interface Props {
  /** De qual porta a pessoa entrou. Define a grade e o padrão do editor. */
  escopo: EscopoTreinamento;
}

// "Quem pode adicionar treinamentos" na Central de Serviços (14/10/2026, mig
// 20261014000022): menu fantasma no módulo Central de Serviços, em
// Gerenciamento de Acesso. Vale só para a grade da Central — quem tem o
// `treinamentos_gerenciar` (módulo Treinamentos) segue gerenciando tudo.
const MENU_GERENCIAR_CENTRAL = "central_servicos_treinamentos_gerenciar";

export default function TreinamentosERP({ escopo }: Props) {
  const { user } = useAuth();
  const meuNome = useMeuNome();
  const { can } = usePermissoes();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const gerenciaTudo = can("incluir", undefined, "treinamentos_gerenciar")
                    || can("alterar", undefined, "treinamentos_gerenciar");
  const gerenciaCentral = escopo === "central_servicos"
    && (can("incluir", undefined, MENU_GERENCIAR_CENTRAL) || can("alterar", undefined, MENU_GERENCIAR_CENTRAL));
  const podeGerenciar = gerenciaTudo || gerenciaCentral;
  const podeExcluirAlgum = can("excluir", undefined, "treinamentos_gerenciar")
    || (escopo === "central_servicos" && can("excluir", undefined, MENU_GERENCIAR_CENTRAL));
  // Quem gerencia só a Central mexe só no que é só da Central: o banco recusa
  // editar um treinamento que também está na grade dos Encarregados.
  const soDaCentral = (t: Treinamento) => (t.escopos ?? []).every(e => e === "central_servicos");
  const podeEditar = (t: Treinamento) => gerenciaTudo || (gerenciaCentral && soDaCentral(t));
  const podeExcluir = (t: Treinamento) => podeExcluirAlgum && (can("excluir", undefined, "treinamentos_gerenciar") || soDaCentral(t));

  // Alertas de quem travou a prova (mig 20261014000020): a notificação abre
  // esta tela com ?alertas=1.
  const podeAlertas = usePodeVerAlertasTreinamento();
  const alertas = useAlertasTreinamento(podeAlertas);
  const alertasAbertos = (alertas.data ?? []).filter(a => a.status === "aberto").length;
  const alertasVisiveis = podeAlertas && params.get("alertas") === "1";
  const abrirAlertas = (abrir: boolean) => setParams(p => {
    const n = new URLSearchParams(p);
    if (abrir) n.set("alertas", "1"); else n.delete("alertas");
    return n;
  }, { replace: true });

  // Treinamentos de chamados para confirmar (mig 273). A aba "Treinamentos
  // Sistemas" saiu (14/10/2026); quem tem pendência vê o aviso aqui, que
  // leva para a tela de confirmar.
  const confirmacoes = useTreinamentosSistemas();
  const confirmacoesPendentes = escopo === "central_servicos"
    ? (confirmacoes.data ?? []).filter(x => !x.confirmado_em).length : 0;

  const [lista, setLista] = useState<Treinamento[]>([]);
  const [capas, setCapas] = useState<Record<string, string>>({});
  const [conclusoes, setConclusoes] = useState<Record<string, Conclusao>>({});
  const [estados, setEstados] = useState<Record<string, EstadoCard>>({});
  // Filtros por tipo e módulo (14/10/2026): "" = todos.
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroModulo, setFiltroModulo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [editorAberto, setEditorAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Treinamento | null>(null);
  const [assistindo, setAssistindo] = useState<Treinamento | null>(null);
  const [dashboardAberto, setDashboardAberto] = useState(false);

  const carregar = useCallback(async () => {
    // Os dois blocos em paralelo: a grade não precisa esperar o histórico
    // para desenhar, e serializar aqui dobrava o tempo de abertura à toa.
    const [t, c, e] = await Promise.all([
      (supabase as any).from("TREINAMENTOS")
        .select("*")
        // `contains` = o array da linha contém este escopo. Traz também os
        // treinamentos marcados nos dois módulos, que é o compartilhamento.
        .contains("escopos", [escopo])
        .order("ordem", { ascending: true }).order("created_at", { ascending: false }),
      (supabase as any).from("TREINAMENTO_CONCLUSAO")
        .select("treinamento_id, prova_nota, aprovado").eq("user_id", user?.id ?? ""),
      (supabase as any).from("TREINAMENTO_PROVA_ESTADO")
        .select("treinamento_id, falhas_seguidas, bloqueado").eq("user_id", user?.id ?? ""),
    ]);
    if (t.error) {
      toast({ title: "Não deu para carregar os treinamentos", description: t.error.message, variant: "destructive" });
    }
    const treinamentos = (t.data ?? []) as Treinamento[];
    setLista(treinamentos);
    const mapa: Record<string, Conclusao> = {};
    for (const row of (c.data ?? []) as Conclusao[]) mapa[row.treinamento_id] = row;
    setConclusoes(mapa);
    const mapaEst: Record<string, EstadoCard> = {};
    for (const row of (e.data ?? []) as EstadoCard[]) mapaEst[row.treinamento_id] = row;
    setEstados(mapaEst);
    setCarregando(false);

    // As capas depois da grade, e numa chamada só: o bucket é privado, então
    // cada imagem precisa de URL assinada — pedir uma por card seria uma
    // requisição por treinamento, e a grade ficaria esperando todas.
    const comCapa = treinamentos.filter(x => x.capa_path);
    if (comCapa.length) {
      const { data: urls } = await supabase.storage.from("treinamentos")
        .createSignedUrls(comCapa.map(x => x.capa_path!), 3600);
      const porPath: Record<string, string> = {};
      for (const u of urls ?? []) if (u.path && u.signedUrl) porPath[u.path] = u.signedUrl;
      const porId: Record<string, string> = {};
      for (const x of comCapa) {
        const url = porPath[x.capa_path!];
        if (url) porId[x.id] = url;
      }
      setCapas(porId);
    } else {
      setCapas({});
    }
  }, [user?.id, toast, escopo]);

  useEffect(() => { carregar(); }, [carregar]);

  // Visualizações e curtidas de cada vídeo, numa chamada só (mig 20261005000004).
  const numeros = useNumerosTreinamentos(useMemo(() => lista.map(x => x.id), [lista]));

  // Os tipos e módulos que existem na grade viram os filtros.
  const tipos = useMemo(
    () => [...new Set(lista.map(t => (t.tipo ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [lista]);
  const modulos = useMemo(
    () => [...new Set(lista.map(t => t.modulo_sistema ?? "").filter(Boolean))],
    [lista]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter(t =>
      (!filtroTipo || (t.tipo ?? "").trim() === filtroTipo)
      && (!filtroModulo || t.modulo_sistema === filtroModulo)
      && (!q || t.titulo.toLowerCase().includes(q) || (t.descricao ?? "").toLowerCase().includes(q)
             || (t.tipo ?? "").toLowerCase().includes(q)
             || labelDe(MODULOS_ERP, t.modulo_sistema).toLowerCase().includes(q)));
  }, [lista, busca, filtroTipo, filtroModulo]);

  // Reprovado não conta como feito: com prova, feito é aprovado.
  const feitos = useMemo(
    () => lista.filter(t => conclusoes[t.id] && conclusoes[t.id].aprovado !== false).length, [lista, conclusoes]);

  const excluir = async (t: Treinamento) => {
    if (!window.confirm(
      `Excluir "${t.titulo}"?\n\nIsso apaga também o registro de quem já fez o treinamento. Para apenas tirar do ar, edite o card e desligue "Publicado".`
    )) return;
    const { error } = await (supabase as any).from("TREINAMENTOS").delete().eq("id", t.id);
    if (error) { toast({ title: "Não deu para excluir", description: error.message, variant: "destructive" }); return; }
    // O CASCADE leva a linha e o histórico, mas não toca no bucket: sem isto
    // vídeo, anexo e capa ficariam ocupando storage para sempre, sem dono.
    const arquivos = [t.video_path, t.anexo_path, t.capa_path].filter(Boolean) as string[];
    if (arquivos.length) await supabase.storage.from("treinamentos").remove(arquivos);
    toast({ title: "Treinamento excluído" });
    carregar();
  };

  const resumo = carregando ? "Carregando…"
    : lista.length === 0 ? "Nenhum treinamento publicado ainda"
    : `${lista.length} ${lista.length === 1 ? "treinamento" : "treinamentos"} · você concluiu ${feitos}`;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ---- cabeçalho ---- */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-lg">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {escopo === "central_servicos" ? "Treinamentos" : "Treinamentos ERP"}
            </h1>
            <p className="text-sm text-muted-foreground">{resumo}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="w-full pl-9 md:w-64" placeholder="Buscar treinamento…"
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          {/* Quem enxerga o relatório de quem assistiu é decidido no toggle de
              Administração › Acesso por Usuário (menu `treinamentos_dashboard`),
              não aqui — e as RPCs por trás cobram o mesmo código, então
              esconder o botão é conforto, não a tranca. */}
          <AcessoGate menu="treinamentos_dashboard" acao="visualizar">
            <Button variant="outline" onClick={() => setDashboardAberto(true)}>
              <BarChart3 className="mr-2 h-4 w-4" /> Dashboard de vídeos
            </Button>
          </AcessoGate>
          {podeAlertas && (
            <Button variant="outline" onClick={() => abrirAlertas(true)} className="gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Alertas
              {alertasAbertos > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{alertasAbertos}</span>
              )}
            </Button>
          )}
          {podeGerenciar && (
            <Button onClick={() => { setEmEdicao(null); setEditorAberto(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Novo
            </Button>
          )}
        </div>
      </div>

      {confirmacoesPendentes > 0 && (
        <Link to={ROTA_TREINAMENTOS_SISTEMAS}
          className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm transition-colors hover:bg-primary/10">
          <MonitorCog className="h-5 w-5 shrink-0 text-primary" />
          <span className="flex-1">
            Você tem <b>{confirmacoesPendentes}</b> treinamento{confirmacoesPendentes > 1 ? "s" : ""} de novidade do ERP para confirmar o recebimento.
          </span>
          <span className="font-semibold text-primary">Confirmar →</span>
        </Link>
      )}

      {/* ---- filtros por tipo e módulo (só aparecem quando há o que filtrar) ---- */}
      {!carregando && (tipos.length > 1 || modulos.length > 1) && (
        <div className="space-y-2">
          {tipos.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
              {["", ...tipos].map(x => (
                <button key={x || "_todos"} type="button" onClick={() => setFiltroTipo(x)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    filtroTipo === x ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"}`}>
                  {x || "Todos os tipos"}
                </button>
              ))}
            </div>
          )}
          {modulos.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Boxes className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
              {["", ...modulos].map(x => (
                <button key={x || "_todos"} type="button" onClick={() => setFiltroModulo(x)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    filtroModulo === x ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"}`}>
                  {x ? labelDe(MODULOS_ERP, x) : "Todos os módulos"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- barra de progresso ---- */}
      {!carregando && lista.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Award className="h-4 w-4 text-primary" /> Seu progresso
            </span>
            <span className="tabular-nums text-muted-foreground">{feitos} de {lista.length}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-700 ease-out"
                 style={{ width: `${lista.length ? (feitos / lista.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* ---- grade ---- */}
      {carregando ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando treinamentos…
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <GraduationCap className="h-12 w-12 text-muted-foreground/40" />
          <p className="font-medium">
            {busca ? "Nenhum treinamento com esse termo" : "Ainda não há treinamentos"}
          </p>
          {!busca && podeGerenciar && (
            <Button variant="outline" onClick={() => { setEmEdicao(null); setEditorAberto(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Criar o primeiro
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((t, i) => {
            const r = recursosDe(t);
            const conc = conclusoes[t.id];
            // Com a prova corrigida no banco (mig 20261014000020), a conclusão
            // também guarda a reprovação — e reprovado não é "feito".
            const feito = conc && conc.aprovado !== false ? conc : undefined;
            const reprovado = conc?.aprovado === false ? conc : undefined;
            const travado = !!estados[t.id]?.bloqueado;
            return (
              <div key={t.id}
                // O delay escalonado dá a entrada em cascata da grade. Teto de
                // 300ms para uma lista grande não demorar a terminar de aparecer.
                style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}
                className="group flex animate-in flex-col overflow-hidden rounded-xl border bg-card fade-in slide-in-from-bottom-2 fill-mode-backwards duration-300 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl">

                {/* capa: a imagem quando existe, o gradiente quando não */}
                <div className="relative flex h-32 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
                  {capas[t.id] ? (
                    <img src={capas[t.id]} alt="" loading="lazy"
                         className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <GraduationCap className="h-10 w-10 text-primary/40 transition-transform duration-300 group-hover:scale-110" />
                  )}
                  {feito && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                      <CheckCircle2 className="h-3 w-3" />
                      {feito.prova_nota != null ? `${feito.prova_nota}%` : "Concluído"}
                    </span>
                  )}
                  {travado ? (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                      <Lock className="h-3 w-3" /> Prova travada
                    </span>
                  ) : reprovado && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                      <RotateCcw className="h-3 w-3" /> {reprovado.prova_nota}% · refazer
                    </span>
                  )}
                  {!t.publicado && (
                    // Fundo sólido escuro, e não bg-muted: sobre uma capa
                    // clara o selo translúcido sumia.
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-slate-900/85 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                      <EyeOff className="h-3 w-3" /> Rascunho
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="space-y-1">
                    <h3 className="font-semibold leading-tight">{t.titulo}</h3>
                    {t.descricao && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{t.descricao}</p>
                    )}
                  </div>

                  {/* selos do que o card oferece */}
                  <div className="flex flex-wrap gap-1.5">
                    {t.tipo && (
                      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Tag className="h-3 w-3" /> {t.tipo}
                      </span>
                    )}
                    {t.modulo_sistema && (
                      <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                        <Boxes className="h-3 w-3" /> {labelDe(MODULOS_ERP, t.modulo_sistema)}
                      </span>
                    )}
                    {r.video && (
                      <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        <Video className="h-3 w-3" /> Vídeo
                      </span>
                    )}
                    {r.anexo && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        <Paperclip className="h-3 w-3" /> Anexo
                      </span>
                    )}
                    {r.prova && (
                      <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        <ListChecks className="h-3 w-3" /> {r.questoes} {r.questoes === 1 ? "questão" : "questões"}
                        {t.max_tentativas != null && ` · ${t.max_tentativas} tentativa${t.max_tentativas === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </div>

                  {r.video && <ReacoesVideoMini numeros={numeros.data?.[t.id]} />}

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Button className="flex-1" size="sm" onClick={() => setAssistindo(t)}>
                      <PlayCircle className="mr-2 h-4 w-4" />
                      {feito ? "Rever" : reprovado ? "Continuar" : "Começar"}
                    </Button>
                    {podeEditar(t) && (
                      <Button variant="ghost" size="icon" title="Editar"
                              onClick={() => { setEmEdicao(t); setEditorAberto(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {podeExcluir(t) && (
                      <Button variant="ghost" size="icon" title="Excluir" className="text-destructive"
                              onClick={() => excluir(t)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TreinamentoEditor
        aberto={editorAberto}
        treinamento={emEdicao}
        escopoPadrao={escopo}
        escopoTravado={gerenciaTudo ? null : escopo}
        meuNome={meuNome}
        meuId={user?.id}
        onFechar={() => setEditorAberto(false)}
        onSalvo={carregar}
      />

      <TreinamentoVisor
        treinamento={assistindo}
        meuNome={meuNome}
        meuId={user?.id}
        escopo={escopo}
        jaFeito={assistindo && conclusoes[assistindo.id]?.aprovado !== false ? conclusoes[assistindo.id] ?? null : null}
        onFechar={() => setAssistindo(null)}
        onConcluido={carregar}
      />

      <DashboardVideos
        aberto={dashboardAberto}
        onFechar={() => setDashboardAberto(false)}
        escopo={escopo}
      />

      <Dialog open={alertasVisiveis} onOpenChange={o => abrirAlertas(o)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Alertas de treinamento</DialogTitle></DialogHeader>
          <AlertasTreinamento />
        </DialogContent>
      </Dialog>
    </div>
  );
}
