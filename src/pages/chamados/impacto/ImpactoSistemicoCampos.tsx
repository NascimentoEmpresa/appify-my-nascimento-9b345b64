import { useMemo, useState } from "react";
import { Crosshair, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useSetoresEmpresa } from "@/hooks/useSetoresEmpresa";
import { POSICAO_OUTRO, trocarPosicao } from "@/lib/chamados/impactoSistemico";
import { opcoesSetoresImpactados } from "../impactados";
import { ModulosImpactadosSelect, PosicaoModuloSelect } from "./ModulosImpactadosSelect";

// =====================================================================
// FORMULÁRIO DE IMPACTO SISTÊMICO (SIS-2026-0910) — Abrir Novo Chamado.
//
// Substitui o campo único "Módulo / Sistema", que misturava onde a mudança é
// feita com o que ela atinge. Três campos, como no modelo anexado ao chamado:
//   1. Módulos do sistema impactados (vários, obrigatório);
//   2. Setores impactados (vários, obrigatório);
//   3. Posição do novo módulo ou módulo diretamente ajustado (um,
//      obrigatório) — grava em modulo_sistema, a coluna de sempre.
// A posição entra sozinha nos módulos impactados (regra em
// lib/chamados/impactoSistemico.ts; o banco garante o mesmo no trigger da
// mig 20261117181000). Os ids `campo-*` são os alvos do "faltam N campos".
// =====================================================================

export interface ImpactoSistemicoCamposProps {
  modulos: string[];
  onModulos: (v: string[]) => void;
  setores: string[];
  onSetores: (v: string[]) => void;
  posicao: string;
  onPosicao: (v: string) => void;
  posicaoOutro: string;
  onPosicaoOutro: (v: string) => void;
}

const obrigatorio = <span className="text-destructive">*</span>;

export function ImpactoSistemicoCampos({
  modulos, onModulos, setores, onSetores, posicao, onPosicao, posicaoOutro, onPosicaoOutro,
}: ImpactoSistemicoCamposProps) {
  const { data: setoresEmpresa = [] } = useSetoresEmpresa();
  const opcoesSetores = useMemo(() => opcoesSetoresImpactados(setoresEmpresa), [setoresEmpresa]);
  // A posição atual foi posta nos impactados pela troca (e não escolhida)?
  // Se foi, trocar a posição tira a antiga; se a pessoa a escolheu, fica.
  const [posicaoAutomatica, setPosicaoAutomatica] = useState(false);

  const mudarPosicao = (nova: string) => {
    onModulos(trocarPosicao(modulos, posicao, nova, posicaoAutomatica));
    setPosicaoAutomatica(nova !== POSICAO_OUTRO && !modulos.includes(nova));
    onPosicao(nova);
  };

  return (
    // Sem moldura nem título próprio (17/11/2026): no modelo anexado ao
    // chamado os três campos ficam soltos na Classificação, logo acima da
    // Prioridade — módulos | setores numa linha e a posição embaixo.
    <div className="space-y-4">

      <div className="grid gap-4 md:grid-cols-2">
        <div id="campo-modulos-impactados" className="scroll-mt-24">
          <Label className="mb-1.5 block text-xs font-semibold">Módulos do sistema impactados {posicao === POSICAO_OUTRO
            ? <span className="font-normal text-muted-foreground">(opcional quando a posição é "Outro")</span>
            : obrigatorio}</Label>
          <ModulosImpactadosSelect value={modulos} onChange={onModulos} posicao={posicao} />
        </div>
        <div id="campo-setores-impactados" className="scroll-mt-24">
          <Label className="mb-1.5 block text-xs font-semibold" title="Setores cujos processos ou informações mudam com a entrega">Setor(es) impactado(s) {obrigatorio}</Label>
          <SearchableMultiSelect value={setores} onChange={onSetores} options={opcoesSetores}
            badgeClassName="border-accent/30 bg-accent/10 font-medium text-accent hover:bg-accent/15"
            placeholder="Selecionar setores impactados" searchPlaceholder="Buscar setor..." emptyLabel="Nenhum setor encontrado" />
        </div>
      </div>

      <div id="campo-modulo" className="scroll-mt-24">
        <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          Posição do novo módulo ou módulo diretamente ajustado {obrigatorio}
        </Label>
        {/* SIS-2026-0921: mesma árvore Setor → telas da barra lateral (uma tela, ou "Outro"). */}
        <PosicaoModuloSelect value={posicao} onChange={mudarPosicao} />
        {posicao === POSICAO_OUTRO && (
          <Input className="mt-2 bg-background" placeholder="Qual sistema?" value={posicaoOutro} onChange={(e) => onPosicaoOutro(e.target.value)} />
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Onde a alteração é efetivamente feita. Entra automaticamente nos módulos impactados.</p>
      </div>
    </div>
  );
}
