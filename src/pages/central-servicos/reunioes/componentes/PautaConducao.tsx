import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DecisoesAcoesPainel } from "./DecisoesAcoesPainel";
import {
  NATUREZA_ITEM_LABEL, PERGUNTAS_CONDUCAO_ITEM, nomeUsuario,
  type NaturezaItem, type PerguntaChecklist, type ReuniaoDecisaoAcao, type ReuniaoPauta, type ReuniaoResposta,
  type RespostaConducaoItem, type PrioridadeDecisaoAcao, type StatusDecisaoAcao, type Usuario,
} from "../types";

function LinhaPerguntaConducao({
  pergunta, valor, onChange,
}: {
  pergunta: PerguntaChecklist;
  valor: RespostaConducaoItem | undefined;
  onChange: (v: RespostaConducaoItem) => void;
}) {
  const [observacao, setObservacao] = useState(valor?.observacao ?? "");

  return (
    <div className="space-y-1.5 rounded border border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs font-normal">{pergunta.pergunta}</Label>
        <div className="flex flex-wrap gap-1">
          {pergunta.opcoes.map((o) => (
            <Button
              key={o.value}
              type="button"
              size="sm"
              variant={valor?.resposta === o.value ? "default" : "outline"}
              onClick={() => onChange({ resposta: o.value, observacao: valor?.observacao ?? "" })}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>
      <Input
        placeholder="Observação (opcional)"
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        onBlur={() => onChange({ resposta: valor?.resposta ?? "", observacao })}
        className="h-7 text-xs"
      />
    </div>
  );
}

function RespostaDecisaoItem({
  respostaTexto, respostaEncaminhamento, onSalvar,
}: {
  respostaTexto: string;
  respostaEncaminhamento: string;
  onSalvar: (texto: string, encaminhamento: string) => void;
}) {
  const [texto, setTexto] = useState(respostaTexto);
  const [encaminhamento, setEncaminhamento] = useState(respostaEncaminhamento);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Resposta / Decisão do item</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs font-normal">Resposta / Decisão</Label>
          <Input
            placeholder="Resposta / decisão"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => onSalvar(texto, encaminhamento)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-normal">Observações</Label>
          <Input
            placeholder="Observações"
            value={encaminhamento}
            onChange={(e) => setEncaminhamento(e.target.value)}
            onBlur={() => onSalvar(texto, encaminhamento)}
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

export function PautaConducao({
  pauta, respostas, decisoesAcoes, usuarios, setorPadrao,
  onAtualizarNatureza, onSalvarChecklist, onSalvarResposta, onCriarDecisaoAcao, onCriarAcaoPlanoAcao, onAtualizarDecisaoAcao, onRemoverDecisaoAcao,
}: {
  pauta: ReuniaoPauta[];
  respostas: ReuniaoResposta[];
  decisoesAcoes: ReuniaoDecisaoAcao[];
  usuarios: Usuario[];
  setorPadrao?: string | null;
  onAtualizarNatureza: (pautaId: string, natureza: NaturezaItem) => Promise<boolean>;
  onSalvarChecklist: (pautaId: string, checklist: Record<string, RespostaConducaoItem>) => Promise<boolean>;
  onSalvarResposta: (pautaId: string, texto: string, encaminhamento: string) => Promise<boolean>;
  onCriarDecisaoAcao: (dados: {
    pauta_id: string; tipo: "decisao"; texto: string; responsavel_user_id?: string | null; prazo?: string | null;
    prioridade?: PrioridadeDecisaoAcao; necessita_comprovacao?: boolean; setor_impactado?: string | null;
  }) => Promise<boolean>;
  onCriarAcaoPlanoAcao: (dados: {
    pauta_id: string; titulo: string; tipo_acao?: string; problema?: string | null; acao?: string | null; comite?: string | null;
    tipo_reuniao?: string | null; area?: string | null; prioridade_normalizada?: string; status_normalizado?: string;
    data_inicio_planejado?: string | null; data_fim_planejado?: string | null;
    responsavel_profile_id?: string | null; lider_comite_profile_id?: string | null;
    visibilidade?: string; comentarios?: string | null;
  }) => Promise<boolean>;
  onAtualizarDecisaoAcao: (id: string, patch: Partial<Pick<ReuniaoDecisaoAcao, "status">>) => Promise<boolean>;
  onRemoverDecisaoAcao: (id: string) => Promise<boolean>;
}) {
  const [indice, setIndice] = useState(0);
  const [sinalAbrirAcao, setSinalAbrirAcao] = useState(0);
  const item = pauta[indice];

  if (!item) return <p className="text-sm text-muted-foreground">Nenhum item de pauta cadastrado.</p>;

  const resposta = respostas.find((r) => r.pauta_id === item.id);
  const checklistAtual = resposta?.checklist_conducao ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Item {indice + 1} de {pauta.length}</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={indice === 0} onClick={() => setIndice((i) => i - 1)}>Item anterior</Button>
          <Button type="button" size="sm" variant="outline" disabled={indice === pauta.length - 1} onClick={() => setIndice((i) => i + 1)}>Próximo item</Button>
        </div>
      </div>

      <div>
        <p className="text-base font-semibold">{item.titulo_topico}</p>
        <p className="text-xs text-muted-foreground">
          Responsável pelo item: {nomeUsuario(usuarios, item.responsavel_user_id) ?? "—"}
          {item.prazo && ` · Prazo: ${new Date(item.prazo).toLocaleDateString("pt-BR")}`}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Natureza do item</Label>
        <Select value={item.natureza ?? ""} onValueChange={(v) => onAtualizarNatureza(item.id, v as NaturezaItem)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(NATUREZA_ITEM_LABEL) as NaturezaItem[]).map((n) => (
              <SelectItem key={n} value={n}>{NATUREZA_ITEM_LABEL[n]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RespostaDecisaoItem
        key={item.id}
        respostaTexto={resposta?.texto_resposta ?? ""}
        respostaEncaminhamento={resposta?.encaminhamento ?? ""}
        onSalvar={(texto, encaminhamento) => onSalvarResposta(item.id, texto, encaminhamento)}
      />

      <div className="space-y-2">
        <p className="text-sm font-semibold">Condução do item</p>
        {PERGUNTAS_CONDUCAO_ITEM.map((p) => (
          <LinhaPerguntaConducao
            key={`${item.id}_${p.id}`}
            pergunta={p}
            valor={checklistAtual[p.id]}
            onChange={(v) => {
              onSalvarChecklist(item.id, { ...checklistAtual, [p.id]: v });
              if (p.id === "gerou_acao" && v.resposta === "sim_criar") setSinalAbrirAcao((n) => n + 1);
            }}
          />
        ))}
      </div>

      <DecisoesAcoesPainel
        pautaId={item.id}
        itens={decisoesAcoes.filter((d) => d.pauta_id === item.id)}
        usuarios={usuarios}
        setorPadrao={setorPadrao}
        sinalAbrirAcao={sinalAbrirAcao}
        onCriarDecisao={onCriarDecisaoAcao}
        onCriarAcao={onCriarAcaoPlanoAcao}
        onAtualizar={onAtualizarDecisaoAcao}
        onRemover={onRemoverDecisaoAcao}
      />
    </div>
  );
}
