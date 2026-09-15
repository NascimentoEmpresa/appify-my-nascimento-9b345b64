// Vínculo da vaga com o catálogo de Suprimentos (contrato → posto → função).
//
// É o que define uniformes e EPIs da admissão. Desde 15/09/2026:
//   • aparece em TODO formulário de vaga (encarregado, Central, Recrutamento);
//   • é OPCIONAL — sem posto no catálogo, o Compras monta a lista na admissão;
//   • o CONTRATO nunca é escolhido aqui: vem do contrato da vaga (o do
//     colaborador escolhido, ou o digitado no modo manual), casado pelo nome
//     com o catálogo, e fica travado. Sobra escolher posto e função.
//
// Os ids gravados (contrato_id/posto_id/funcao_id) são os do catálogo
// (contratos / sup_posto / sup_funcao).
import { useEffect, useMemo } from "react";

import { useContratosCatalogo, usePostos, useFuncoes } from "@/hooks/useSupCatalogo";
import { semCodigoFilial } from "@/lib/rh/colaboradoresUtils";

export interface VinculoCatalogo { contrato_id: string; posto_id: string; funcao_id: string }

interface Props {
  /** Contrato da vaga, como a tela mostra ("1109 - POLÍCIA CIVIL…" ou só o nome). */
  contratoNome: string;
  valor: VinculoCatalogo;
  onChange: (v: VinculoCatalogo) => void;
  /** Chamado quando uma função é escolhida — só o modo manual usa pra sugerir o cargo. */
  onFuncaoNome?: (nome: string) => void;
  /** Classe dos inputs da tela que está usando (nvg-fi / ini-fi). */
  classeInput: string;
  classeGrupo: string;
}

const chaveNome = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

export function VinculoCatalogoVaga({ contratoNome, valor, onChange, onFuncaoNome, classeInput, classeGrupo }: Props) {

  const { data: contratos = [] } = useContratosCatalogo();

  const contratoCatalogo = useMemo(() => {
    const alvo = chaveNome(semCodigoFilial(contratoNome));
    if (!alvo) return null;
    return contratos.find(c => chaveNome(c.nome) === alvo) ?? null;
  }, [contratos, contratoNome]);

  // O contrato do catálogo acompanha o contrato da vaga — sempre. Mudou o
  // contrato (trocou de colaborador), posto e função voltam a vazio.
  useEffect(() => {
    const id = contratoCatalogo?.id ?? "";
    if (valor.contrato_id !== id) onChange({ contrato_id: id, posto_id: "", funcao_id: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoCatalogo?.id]);

  const { data: postos = [] } = usePostos(valor.contrato_id || null);
  const { data: funcoes = [] } = useFuncoes(valor.posto_id || null);

  const travado = { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" as const };
  const semContrato = !contratoNome.trim();
  const naoAchou = !semContrato && contratos.length > 0 && !contratoCatalogo;

  return (
    <div className={classeGrupo} style={{ gridColumn: "1 / -1" }}>
      <label>
        Vínculo com o catálogo de Suprimentos
        <span style={{ color: "#94a3b8", fontWeight: 600 }}> — opcional</span>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <input className={classeInput} readOnly style={travado}
          title="É o contrato da vaga — não pode ser trocado aqui."
          value={contratoCatalogo?.nome ?? ""}
          placeholder={semContrato ? "Escolha o colaborador" : naoAchou ? "Contrato fora do catálogo" : "Contrato"} />
        <select className={classeInput} value={valor.posto_id} disabled={!valor.contrato_id}
          onChange={e => onChange({ ...valor, posto_id: e.target.value, funcao_id: "" })}>
          <option value="">{valor.contrato_id ? "Posto (opcional)" : "—"}</option>
          {postos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select className={classeInput} value={valor.funcao_id} disabled={!valor.posto_id}
          onChange={e => {
            const id = e.target.value;
            onChange({ ...valor, funcao_id: id });
            const f = funcoes.find(x => x.id === id);
            if (f && onFuncaoNome) onFuncaoNome(f.nome);
          }}>
          <option value="">{valor.posto_id ? "Função (opcional)" : "—"}</option>
          {funcoes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: naoAchou ? "#92400e" : "#64748b" }}>
        {naoAchou
          ? `"${semCodigoFilial(contratoNome)}" não está no catálogo de Suprimentos — a vaga segue sem vínculo e o Compras monta os uniformes/EPIs na admissão.`
          : "Define automaticamente os uniformes e EPIs da admissão. O contrato é o da vaga e não muda; posto e função são opcionais."}
      </div>
    </div>
  );
}
