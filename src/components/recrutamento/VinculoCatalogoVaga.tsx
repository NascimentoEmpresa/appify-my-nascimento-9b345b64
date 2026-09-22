// Vínculo da vaga com o catálogo de Suprimentos (contrato → posto → função).
//
// É o que define uniformes e EPIs da admissão. Desde 15/09/2026:
//   • aparece em TODO formulário de vaga (encarregado, Central, Recrutamento);
//   • posto e função são OBRIGATÓRIOS quando o contrato tem posto no
//     catálogo: é do posto que saem o V.A e o V.T da vaga (Planilha de
//     Custo). Contrato fora do catálogo / sem posto segue sem vínculo, com
//     aviso — aí o Compras monta a lista na admissão e o Recrutamento
//     completa os benefícios;
//   • o CONTRATO nunca é escolhido aqui: vem do contrato da vaga (o do
//     colaborador escolhido, ou o digitado no modo manual), casado pelo nome
//     com o catálogo, e fica travado. Sobra escolher posto e função.
//
// Os ids gravados (contrato_id/posto_id/funcao_id) são os do catálogo
// (contratos / sup_posto / sup_funcao).
import { useEffect, useMemo, useRef } from "react";

import { useContratosCatalogo, usePostos, useFuncoes } from "@/hooks/useSupCatalogo";
import { semCodigoFilial } from "@/lib/rh/colaboradoresUtils";
import { chaveContrato } from "@/lib/recrutamento/vagaRegras";

export interface VinculoCatalogo { contrato_id: string; posto_id: string; funcao_id: string }
export interface OpcaoCatalogo { id: string; nome: string }
/** O que o catálogo oferece pro contrato da vaga — a tela usa pra validar e pra achar o nome do posto. */
export interface ListasCatalogo { postos: OpcaoCatalogo[]; funcoes: OpcaoCatalogo[] }

interface Props {
  /** Contrato da vaga, como a tela mostra ("1109 - POLÍCIA CIVIL…" ou só o nome). */
  contratoNome: string;
  valor: VinculoCatalogo;
  onChange: (v: VinculoCatalogo) => void;
  /** Chamado quando uma função é escolhida — só o modo manual usa pra sugerir o cargo. */
  onFuncaoNome?: (nome: string) => void;
  /** Listas de posto/função do contrato atual, sempre que mudam — a tela valida e casa o posto com a planilha. */
  onListas?: (l: ListasCatalogo) => void;
  /** Classe dos inputs da tela que está usando (nvg-fi / ini-fi). */
  classeInput: string;
  classeGrupo: string;
}

const chaveNome = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

export function VinculoCatalogoVaga({ contratoNome, valor, onChange, onFuncaoNome, onListas, classeInput, classeGrupo }: Props) {

  const { data: contratos = [] } = useContratosCatalogo();

  // Exato primeiro; senão, normalizado (22/09/2026): o Senior grava
  // "UFRGS DIGITADORES 014.2026" e o catálogo "UFRGS DIGITADORES - 014/2026"
  // — a comparação exata dava "fora do catálogo" e travava o posto em 15
  // contratos que estão, sim, no catálogo.
  const contratoCatalogo = useMemo(() => {
    const nome = semCodigoFilial(contratoNome);
    if (!chaveNome(nome)) return null;
    return contratos.find(c => chaveNome(c.nome) === chaveNome(nome))
      ?? contratos.find(c => chaveContrato(c.nome) === chaveContrato(nome))
      ?? null;
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

  // Entrega as listas pra tela (validação + nome do posto pra planilha).
  const onListasRef = useRef(onListas); onListasRef.current = onListas;
  useEffect(() => {
    onListasRef.current?.({
      postos: postos.map(p => ({ id: p.id, nome: p.nome })),
      funcoes: funcoes.map(f => ({ id: f.id, nome: f.nome })),
    });
  }, [postos, funcoes]);
  const exigePosto = !!valor.contrato_id && postos.length > 0;
  const exigeFuncao = !!valor.posto_id && funcoes.length > 0;
  const faltaPosto = exigePosto && !valor.posto_id;
  const faltaFuncao = exigeFuncao && !valor.funcao_id;

  const travado = { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" as const };
  const semContrato = !contratoNome.trim();
  const naoAchou = !semContrato && contratos.length > 0 && !contratoCatalogo;

  return (
    <div className={classeGrupo} style={{ gridColumn: "1 / -1" }}>
      <label>
        Vínculo com o catálogo de Suprimentos
        {exigePosto
          ? <span style={{ color: "#dc2626" }}> *</span>
          : <span style={{ color: "#94a3b8", fontWeight: 600 }}> — sem posto no catálogo</span>}
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <input className={classeInput} readOnly style={travado}
          title="É o contrato da vaga — não pode ser trocado aqui."
          value={contratoCatalogo?.nome ?? ""}
          placeholder={semContrato ? "Escolha o colaborador" : naoAchou ? "Contrato fora do catálogo" : "Contrato"} />
        <select className={classeInput} value={valor.posto_id} disabled={!valor.contrato_id}
          style={faltaPosto ? { borderColor: "#dc2626" } : undefined}
          onChange={e => onChange({ ...valor, posto_id: e.target.value, funcao_id: "" })}>
          <option value="">{!valor.contrato_id ? "—" : exigePosto ? "Selecione o posto *" : "Contrato sem posto no catálogo"}</option>
          {postos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select className={classeInput} value={valor.funcao_id} disabled={!valor.posto_id}
          style={faltaFuncao ? { borderColor: "#dc2626" } : undefined}
          onChange={e => {
            const id = e.target.value;
            onChange({ ...valor, funcao_id: id });
            const f = funcoes.find(x => x.id === id);
            if (f && onFuncaoNome) onFuncaoNome(f.nome);
          }}>
          <option value="">{!valor.posto_id ? "—" : exigeFuncao ? "Selecione a função *" : "Posto sem função no catálogo"}</option>
          {funcoes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: naoAchou || faltaPosto || faltaFuncao ? "#92400e" : "#64748b", fontWeight: faltaPosto || faltaFuncao ? 600 : 400 }}>
        {naoAchou
          ? `"${semCodigoFilial(contratoNome)}" não está no catálogo de Suprimentos — a vaga segue sem vínculo; o Compras monta os uniformes/EPIs na admissão e o Recrutamento completa V.A e V.T.`
          : faltaPosto
            ? "Selecione o posto: é dele que vêm o V.A e o V.T da vaga (Planilha de Custo). Sem posto, os valores não são puxados."
            : faltaFuncao
              ? "Selecione a função do posto — define os uniformes e EPIs da admissão."
              : "Define os uniformes e EPIs da admissão e de qual posto da Planilha de Custo vêm o V.A e o V.T. O contrato é o da vaga e não muda."}
      </div>
    </div>
  );
}
