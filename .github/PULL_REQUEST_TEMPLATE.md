<!--
O título desta PR precisa começar com o número do chamado que ela resolve,
ex: SIS-2026-0076: Corrige relatório de comissões

Se esta PR não tem chamado relacionado, comece o título com [SEM-CHAMADO]
ou adicione a label "sem-chamado" — senão o check obrigatório não passa.

O bloco abaixo é preenchido automaticamente com os dados do chamado assim que
a PR é aberta/editada (se o título tiver um número válido). Não edite o
conteúdo entre os marcadores — a próxima sincronização sobrescreve.

Esta PR também passa por uma revisão automática, que comenta aqui com um
resumo e um veredito. Ela tem duas camadas: um script de regras absolutas
(credencial exposta, DROP TABLE, RLS desabilitada) e uma revisão de IA para
o que exige julgamento, como policy de RLS que vaza linha entre usuários.
As regras estão em .github/REGRAS-PR.md — leia antes de discutir um achado.

Para rodar as regras absolutas na sua máquina antes de subir: npm run revisar

Se alguma regra estiver errada para o seu caso, use a label
"pular-revisao-ia" e explique o motivo no corpo da PR. Se ela estiver errada
com frequência, corrija a regra em vez de repetir a label.
-->

<!-- chamado:auto:start -->
<!-- chamado:auto:end -->

