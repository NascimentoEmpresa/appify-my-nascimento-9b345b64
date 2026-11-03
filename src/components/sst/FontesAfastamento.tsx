import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// =====================================================================
// SST › Afastamentos e Telemedicina — aba "De onde vêm os dados".
//
// É o levantamento que o chamado pede ao TI: o que já existe nos módulos,
// o que foi relacionado automaticamente e o que exige registro ou cadastro
// novo. A versão longa, para o solicitante ler fora do sistema, está em
// docs/sst-afastamentos-levantamento.md — mantenha as duas iguais.
// =====================================================================

type Situacao = "auto" | "relacionado" | "registro";

const SIT: Record<Situacao, { r: string; cor: string }> = {
  auto: { r: "Já disponível — automático", cor: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  relacionado: { r: "Relacionado automaticamente", cor: "border-sky-200 bg-sky-50 text-sky-800" },
  registro: { r: "Exige registro / cadastro", cor: "border-amber-200 bg-amber-50 text-amber-800" },
};

interface Linha { item: string; dado: string; fonte: string; sit: Situacao; obs?: string }

const LINHAS: Linha[] = [
  // Os afastamentos em si
  { item: "Afastamentos", dado: "Quem está afastado hoje (atestado, auxílio-doença, férias, licença, demais afastamentos)", fonte: "Senior → EMPREGADOS (situação e Data Afastamento, a cada 15 min)", sit: "auto", obs: "Capturado de hora em hora. O retorno é marcado quando a situação volta a Trabalhando." },
  { item: "Afastamentos", dado: "Desligamentos (últimos 180 dias)", fonte: "Senior → EMPREGADOS (Demitido + data) e Solicitações de Demissão", sit: "auto" },
  { item: "Afastamentos", dado: "Férias aprovadas (saída e retorno)", fonte: "Central de Serviços / RH › Férias", sit: "auto" },
  { item: "Afastamentos", dado: "Ausências registradas pelos encarregados (atestado, afastamento, férias)", fonte: "Operacional › Efetividade", sit: "auto" },
  { item: "Afastamentos", dado: "Atestados curtos que já terminaram (histórico dia a dia)", fonte: "Planilha de telemedicina (Importar planilha) ou Novo afastamento", sit: "registro", obs: "O espelho da Senior só tem a situação ATUAL. Para trazer o histórico sozinho, a integração precisa espelhar o histórico de afastamentos da Senior (tabela R038AFA) — ajuste de integração a pedir ao TI." },
  // 1
  { item: "1. Lotação", dado: "Contrato vigente", fonte: "Filial da Senior + depara do RH › Ativos/Contratos", sit: "relacionado" },
  { item: "1. Lotação", dado: "Posto de trabalho", fonte: "Posto da Senior + depara de postos / ajuste por pessoa (Ativos/Contratos)", sit: "relacionado", obs: "Sem posto ligado na Planilha de Custo → ajuste de cadastro em RH › Ativos/Contratos." },
  { item: "1. Lotação", dado: "Escala e cargo", fonte: "Senior → EMPREGADOS", sit: "auto" },
  { item: "1. Lotação", dado: "Valor mensal do posto", fonte: "Planilha de Custo EXECUTADA vigente na data do afastamento", sit: "relacionado", obs: "Contrato sem Planilha de Custo cadastrada fica sem valor (cadastro na Controladoria)." },
  { item: "1. Lotação", dado: "Lotação NA DATA (e não a de hoje)", fonte: "Gravada no afastamento quando ele entra", sit: "auto", obs: "Transferências anteriores à captura não têm histórico na Senior espelhada." },
  // 2
  { item: "2. Reserva Técnica", dado: "Existe RT no contrato? Quem é?", fonte: "RH › Ativos/Contratos (posto RENDA TÉCNICA)", sit: "relacionado" },
  { item: "2. Reserva Técnica", dado: "RT usada para cobrir a ausência", fonte: "Efetividade (substituto marcado como RT) ou cobertura registrada tipo RT", sit: "relacionado" },
  // 3
  { item: "3. Cobertura", dado: "Substituições e remanejamentos", fonte: "Efetividade (cobertura acionada com substituto)", sit: "relacionado" },
  { item: "3. Cobertura", dado: "Diaristas e o valor pago", fonte: "Operacional › Diárias (faltante = o afastado)", sit: "relacionado" },
  { item: "3. Cobertura", dado: "Horas extras", fonte: "Sistemas › Hora Extra (mesma filial, nos dias do afastamento)", sit: "relacionado", obs: "A HE não diz quem foi coberto: aparece na ficha como possível cobertura e entra no custo com \"Lançar como cobertura\"." },
  { item: "3. Cobertura", dado: "Transporte, benefício extra e outras despesas", fonte: "Registro na ficha do afastamento", sit: "registro" },
  // 4
  { item: "4. Atestado e telemedicina", dado: "Dias, tipo, CID, médico", fonte: "Ficha do afastamento / planilha importada", sit: "registro", obs: "A Senior não informa os dias previstos nem o CID." },
  { item: "4. Atestado e telemedicina", dado: "Encaminhamento, avaliação, resultado, dias após a avaliação", fonte: "Ficha do afastamento / planilha de telemedicina", sit: "registro" },
  { item: "4. Atestado e telemedicina", dado: "Acompanhamento do retorno", fonte: "Senior (volta a Trabalhando) + anotação na ficha", sit: "auto" },
  // 5
  { item: "5. Financeiro", dado: "Faturamento realizado do contrato", fonte: "Emissão de NF (notas emitidas por competência)", sit: "relacionado" },
  { item: "5. Financeiro", dado: "Glosas e faltas descontadas na nota", fonte: "Itens da NF (faltas, glosas, outros descontos)", sit: "relacionado", obs: "A nota não diz QUAL afastamento foi glosado: a perda por afastamento é estimada (dias sem cobertura × valor/dia do posto) até alguém informar a glosa real na ficha." },
  { item: "5. Financeiro", dado: "Custo do posto e margem de contribuição", fonte: "Planilha de Custo (valor − custo do posto) menos o impacto apurado", sit: "relacionado" },
  { item: "5. Financeiro", dado: "Custos adicionais", fonte: "Diárias + horas extras lançadas + despesas registradas", sit: "relacionado" },
];

export function FontesAfastamento() {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-bold text-[#0f3171]">O que o sistema já sabe, o que ele relaciona sozinho e o que precisa ser registrado</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Levantamento pedido no chamado. Verde: vem pronto de outro módulo. Azul: o sistema cruza sozinho dados de módulos diferentes.
          Amarelo: precisa de alguém registrar (na ficha do afastamento, importando a planilha ou ajustando um cadastro).
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(SIT) as Situacao[]).map((k) => <Badge key={k} variant="outline" className={SIT[k].cor}>{SIT[k].r}</Badge>)}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">Item do chamado</th><th className="pr-2">Informação</th><th className="pr-2">De onde vem</th><th className="pr-2">Situação</th><th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map((l, i) => (
              <tr key={i} className="border-b align-top last:border-0">
                <td className="py-1.5 pr-2 font-medium">{l.item}</td>
                <td className="pr-2">{l.dado}</td>
                <td className="pr-2 text-muted-foreground">{l.fonte}</td>
                <td className="pr-2"><Badge variant="outline" className={SIT[l.sit].cor}>{SIT[l.sit].r}</Badge></td>
                <td className="text-xs text-muted-foreground">{l.obs ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        <b>Ajustes de cadastro que mais deixam o impacto incompleto:</b> colaborador sem posto ligado à Planilha de Custo (RH › Ativos/Contratos),
        filial da Senior sem contrato no depara, contrato sem Planilha de Custo executada e nomes da planilha de telemedicina diferentes do cadastro
        (a ficha mostra "sem cadastro" e deixa vincular). Cada ficha avisa quando falta um desses.
      </div>
    </Card>
  );
}
