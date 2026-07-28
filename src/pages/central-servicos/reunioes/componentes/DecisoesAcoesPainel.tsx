import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { useComitesMap } from "@/hooks/useComitesMap";
import { useSetoresEmpresa } from "@/hooks/useSetoresEmpresa";
import { acharUsuarioPorNome } from "@/lib/acharUsuarioPorNome";
import {
  STATUS_LABELS, STATUS_ORDEM, PRIORIDADES, PRIORIDADE_LABEL, VISIBILIDADE_OPTIONS, VISIBILIDADE_LABEL,
  TIPO_ACAO_OPTIONS, TIPO_ACAO_LABEL,
} from "@/types/planoAcao";
import {
  PRIORIDADE_DECISAO_ACAO_LABEL, STATUS_DECISAO_ACAO_LABEL, nomeUsuario,
  type PrioridadeDecisaoAcao, type ReuniaoDecisaoAcao, type StatusDecisaoAcao, type TipoDecisaoAcao, type Usuario,
} from "../types";

// Tipo de Reunião é campo independente de Comitê (não compartilha coluna).
const TIPOS_REUNIAO = ["Reunião Extraordinária", "Reunião Ordinária"];
// Opções sintéticas de Comitê que não vêm da tabela comite — líder é fixo por nome.
const COMITE_LIDER_FIXO: Record<string, string> = { Gestor: "helena nascimento", Sistemas: "iury de jesus silva" };

interface NovaDecisao {
  pauta_id: string;
  tipo: "decisao";
  texto: string;
  responsavel_user_id?: string | null;
  prazo?: string | null;
  prioridade?: PrioridadeDecisaoAcao;
  necessita_comprovacao?: boolean;
  setor_impactado?: string | null;
}

interface NovaAcaoPlanoAcao {
  pauta_id: string;
  titulo: string;
  tipo_acao?: string;
  problema?: string | null;
  acao?: string | null;
  comite?: string | null;
  tipo_reuniao?: string | null;
  area?: string | null;
  prioridade_normalizada?: string;
  status_normalizado?: string;
  data_inicio_planejado?: string | null;
  data_fim_planejado?: string | null;
  responsavel_profile_id?: string | null;
  lider_comite_profile_id?: string | null;
  visibilidade?: string;
  comentarios?: string | null;
}

export function DecisoesAcoesPainel({
  pautaId, itens, usuarios, setorPadrao, sinalAbrirAcao, onCriarDecisao, onCriarAcao, onAtualizar, onRemover,
}: {
  pautaId: string;
  itens: ReuniaoDecisaoAcao[];
  usuarios: Usuario[];
  setorPadrao?: string | null;
  /** Nonce: incrementar de fora (botão "Sim, Criar" da pergunta de condução) abre o formulário de Ação automaticamente. */
  sinalAbrirAcao?: number;
  onCriarDecisao: (dados: NovaDecisao) => Promise<boolean>;
  onCriarAcao: (dados: NovaAcaoPlanoAcao) => Promise<boolean>;
  onAtualizar: (id: string, patch: Partial<Pick<ReuniaoDecisaoAcao, "status">>) => Promise<boolean>;
  onRemover: (id: string) => Promise<boolean>;
}) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoDecisaoAcao>("decisao");

  // Campos "Decisão" (formulário simples).
  const [texto, setTexto] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<PrioridadeDecisaoAcao>("media");
  const [necessitaComprovacao, setNecessitaComprovacao] = useState(false);
  const [setorImpactado, setSetorImpactado] = useState("");

  // Campos "Ação" (vira registro real em Plano de Ações — mesma lógica de
  // Comitê → Setor em cascata do módulo Plano de Ações de verdade).
  const [acaoTipoAcao, setAcaoTipoAcao] = useState<string>("acao");
  const [acaoTitulo, setAcaoTitulo] = useState("");
  const [acaoProblema, setAcaoProblema] = useState("");
  const [acaoAcao, setAcaoAcao] = useState("");
  const [acaoComite, setAcaoComite] = useState("");
  const [acaoTipoReuniao, setAcaoTipoReuniao] = useState("");
  const [acaoArea, setAcaoArea] = useState(setorPadrao ?? "");
  const [acaoPrioridade, setAcaoPrioridade] = useState<string>("media");
  const [acaoStatus, setAcaoStatus] = useState<string>("a_definir");
  const [acaoDataInicio, setAcaoDataInicio] = useState("");
  const [acaoDataFim, setAcaoDataFim] = useState("");
  const [acaoResponsavel, setAcaoResponsavel] = useState("");
  const [acaoLider, setAcaoLider] = useState("");
  const [acaoVisibilidade, setAcaoVisibilidade] = useState<string>("privado");
  const [acaoComentarios, setAcaoComentarios] = useState("");
  const [salvandoAcao, setSalvandoAcao] = useState(false);

  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name ?? "—" }));

  const { data: comitesMap = {} } = useComitesMap();
  const comitesReais = useMemo(() => Object.keys(comitesMap).sort((a, b) => a.localeCompare(b, "pt-BR")), [comitesMap]);
  const { data: setoresDisponiveis = [] } = useSetoresEmpresa();

  // Só roda a partir de interação real do usuário com o dropdown de Comitê
  // — preenche o líder automaticamente (fixo pra "Gestor"/"Sistemas", vindo
  // do cadastro do comitê pros demais), mas ele continua editável depois.
  // Setor não depende mais de Comitê — são campos independentes.
  const handleComiteChange = (v: string) => {
    const novoComite = v === "__none" ? "" : v;
    setAcaoComite(novoComite);
    const nomeLiderFixo = COMITE_LIDER_FIXO[novoComite];
    if (nomeLiderFixo) {
      setAcaoLider(acharUsuarioPorNome(opcoesUsuarios, nomeLiderFixo)?.value ?? "");
    } else {
      setAcaoLider(comitesMap[novoComite]?.liderProfileId ?? "");
    }
  };

  useEffect(() => {
    if (sinalAbrirAcao === undefined || sinalAbrirAcao === 0) return;
    setTipo("acao");
    setNovoOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinalAbrirAcao]);

  const limpar = () => {
    setTexto(""); setResponsavel(""); setPrazo(""); setPrioridade("media");
    setNecessitaComprovacao(false); setSetorImpactado("");
    setAcaoTipoAcao("acao"); setAcaoTitulo(""); setAcaoProblema(""); setAcaoAcao(""); setAcaoComite(""); setAcaoTipoReuniao("");
    setAcaoArea(setorPadrao ?? ""); setAcaoPrioridade("media"); setAcaoStatus("a_definir");
    setAcaoDataInicio(""); setAcaoDataFim(""); setAcaoResponsavel(""); setAcaoLider("");
    setAcaoVisibilidade("privado"); setAcaoComentarios("");
    setNovoOpen(false);
  };

  const adicionarDecisao = async () => {
    if (!texto.trim()) return;
    const ok = await onCriarDecisao({
      pauta_id: pautaId, tipo: "decisao", texto: texto.trim(),
      responsavel_user_id: responsavel || null, prazo: prazo || null,
      prioridade, necessita_comprovacao: necessitaComprovacao, setor_impactado: setorImpactado.trim() || null,
    });
    if (ok) limpar();
  };

  const adicionarAcao = async () => {
    if (!acaoTitulo.trim()) return;
    setSalvandoAcao(true);
    const ok = await onCriarAcao({
      pauta_id: pautaId,
      titulo: acaoTitulo.trim(),
      tipo_acao: acaoTipoAcao,
      problema: acaoProblema.trim() || null,
      acao: acaoAcao.trim() || null,
      comite: acaoComite || null,
      tipo_reuniao: acaoTipoReuniao || null,
      area: acaoArea || null,
      prioridade_normalizada: acaoPrioridade,
      status_normalizado: acaoStatus,
      data_inicio_planejado: acaoDataInicio || null,
      data_fim_planejado: acaoDataFim || null,
      responsavel_profile_id: acaoResponsavel || null,
      lider_comite_profile_id: acaoLider || null,
      visibilidade: acaoVisibilidade,
      comentarios: acaoComentarios.trim() || null,
    });
    setSalvandoAcao(false);
    if (ok) limpar();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Decisões e Ações do item ({itens.length})</p>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setNovoOpen((o) => !o)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar decisão ou ação
        </Button>
      </div>

      {itens.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="p-2">Decisão / Ação</th>
                <th className="p-2">Responsável</th>
                <th className="p-2">Prazo</th>
                <th className="p-2">Prioridade</th>
                <th className="p-2">Status</th>
                <th className="p-2">Comprovação?</th>
                <th className="p-2">Setor</th>
                <th className="w-8 p-2" />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-b-0">
                  <td className="max-w-[220px] p-2">
                    <span className="font-medium">{item.tipo === "decisao" ? "Decisão" : "Ação"}:</span> {item.texto}
                    {item.tipo === "acao" && item.plano_acao_id && (
                      <Link
                        to={`/app/plano-acoes/${item.plano_acao_id}`}
                        className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        Ver no Plano de Ações <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </td>
                  <td className="p-2">{nomeUsuario(usuarios, item.responsavel_user_id) ?? "—"}</td>
                  <td className="p-2">{item.prazo ? new Date(item.prazo).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="p-2">{PRIORIDADE_DECISAO_ACAO_LABEL[item.prioridade]}</td>
                  <td className="p-2">
                    {item.tipo === "acao" && item.plano_acao_id ? (
                      STATUS_DECISAO_ACAO_LABEL[item.status]
                    ) : (
                      <Select value={item.status} onValueChange={(v) => onAtualizar(item.id, { status: v as StatusDecisaoAcao })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS_DECISAO_ACAO_LABEL) as StatusDecisaoAcao[]).map((s) => (
                            <SelectItem key={s} value={s}>{STATUS_DECISAO_ACAO_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="p-2">{item.necessita_comprovacao ? "Sim" : "Não"}</td>
                  <td className="p-2">{item.setor_impactado ?? "—"}</td>
                  <td className="p-2">
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemover(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {novoOpen && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={tipo === "decisao" ? "default" : "outline"} onClick={() => setTipo("decisao")}>Decisão</Button>
            <Button type="button" size="sm" variant={tipo === "acao" ? "default" : "outline"} onClick={() => setTipo("acao")}>Ação</Button>
          </div>

          {tipo === "decisao" ? (
            <>
              <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva a decisão..." className="min-h-14 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <SearchableSelect value={responsavel} onChange={setResponsavel} options={opcoesUsuarios} placeholder="Responsável" />
                <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={prioridade} onValueChange={(v) => setPrioridade(v as PrioridadeDecisaoAcao)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORIDADE_DECISAO_ACAO_LABEL) as PrioridadeDecisaoAcao[]).map((p) => (
                      <SelectItem key={p} value={p}>{PRIORIDADE_DECISAO_ACAO_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={setorImpactado} onChange={(e) => setSetorImpactado(e.target.value)} placeholder="Setor impactado" />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={necessitaComprovacao} onCheckedChange={(v) => setNecessitaComprovacao(!!v)} />
                Necessita comprovação?
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={limpar}>Cancelar</Button>
                <Button type="button" size="sm" onClick={adicionarDecisao} disabled={!texto.trim()}>Salvar</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Cadastrar nova ação no plano — vira um registro de verdade no módulo Plano de Ações.</p>

              <Select value={acaoTipoAcao} onValueChange={setAcaoTipoAcao}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Tipo de Ação" /></SelectTrigger>
                <SelectContent>
                  {TIPO_ACAO_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_ACAO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input value={acaoTitulo} onChange={(e) => setAcaoTitulo(e.target.value)} placeholder="Título" />
              <Textarea value={acaoProblema} onChange={(e) => setAcaoProblema(e.target.value)} placeholder="Problema" className="min-h-12 text-sm" />
              <Textarea value={acaoAcao} onChange={(e) => setAcaoAcao(e.target.value)} placeholder="Ação" className="min-h-12 text-sm" />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Comitê</label>
                  <Select value={acaoComite || "__none"} onValueChange={handleComiteChange}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o comitê" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="Gestor">Gestor</SelectItem>
                      <SelectItem value="Sistemas">Sistemas</SelectItem>
                      {comitesReais.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Tipo de Reunião</label>
                  <Select value={acaoTipoReuniao || "__none"} onValueChange={(v) => setAcaoTipoReuniao(v === "__none" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o tipo de reunião" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {TIPOS_REUNIAO.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Setor</label>
                  <Select value={acaoArea || "__none"} onValueChange={(v) => setAcaoArea(v === "__none" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {setoresDisponiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select value={acaoStatus} onValueChange={setAcaoStatus}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDEM.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Prioridade</label>
                  <Select value={acaoPrioridade} onValueChange={setAcaoPrioridade}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORIDADES.map((p) => (
                        <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Data de início</label>
                  <Input type="date" value={acaoDataInicio} onChange={(e) => setAcaoDataInicio(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Data de conclusão</label>
                  <Input type="date" value={acaoDataFim} onChange={(e) => setAcaoDataFim(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Responsável</label>
                  <SearchableSelect value={acaoResponsavel} onChange={setAcaoResponsavel} options={opcoesUsuarios} placeholder="Selecione um usuário" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Líder da Conta</label>
                <SearchableSelect value={acaoLider} onChange={setAcaoLider} options={opcoesUsuarios} placeholder="Selecione o líder" />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Visibilidade</label>
                <Select value={acaoVisibilidade} onValueChange={setAcaoVisibilidade}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VISIBILIDADE_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>{VISIBILIDADE_LABEL[v]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Textarea value={acaoComentarios} onChange={(e) => setAcaoComentarios(e.target.value)} placeholder="Comentários" className="min-h-12 text-sm" />

              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={limpar}>Cancelar</Button>
                <Button type="button" size="sm" onClick={adicionarAcao} disabled={!acaoTitulo.trim() || salvandoAcao}>
                  {salvandoAcao ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
