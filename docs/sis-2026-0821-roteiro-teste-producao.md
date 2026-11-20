# SIS-2026-0821 — roteiro de teste em produção

Este roteiro acompanha uma entrega **digital** de EPI, desde o pedido de materiais até o comprovante confirmado pelo colaborador. Use o protocolo do mesmo pedido em todas as etapas. A ficha é formada com os itens de EPI efetivamente movimentados no estoque; ninguém precisa digitar esses itens outra vez ou anexar uma ficha manuscrita para seguir o fluxo digital.

## Quem faz cada ação

| Identificação | Papel simulado | Ambiente |
| --- | --- | --- |
| **Usuário interno** | Solicitação, Suprimentos e Operacional, com permissões para essas ações | ERP: `https://app.grpnascimento.com.br/app` |
| **Colaborador** | Pessoa que recebe e confirma os EPIs | Somente Portal do Colaborador: `https://app.grpnascimento.com.br/colaborador` |

Eduardo pode executar o papel interno com seu acesso amplo. Para o segundo papel, abra outro perfil de navegador ou janela privativa e entre no portal **com a conta do próprio colaborador que receberá o EPI**. Os dois ambientes devem permanecer em sessões separadas. O CPF no RH, o colaborador vinculado ao pedido e a conta do portal precisam corresponder à mesma pessoa.

**Atenção ao uso em produção:** registre a entrega e confirme o recebimento apenas se houve a entrega real dos EPIs descritos, nas quantidades apresentadas. Essas ações criam evidência trabalhista e histórico de auditoria. Se o objetivo for apenas ensaiar cliques sem entregar equipamentos, use homologação ou encerre o teste antes de **Registrar entrega**. Não use CPF, senha ou confirmação de outra pessoa. Não inclua dados pessoais no relato da PR.

## Preparação

1. **Usuário interno — Verificar a versão em produção.** Acesse o ERP e confirme que existem as telas **Operacional › Entrega de EPIs** (`/app/operacional/entrega-epi`) e **Suprimentos › Entrega de EPIs** (`/app/suprimentos/entregas-epi`). A rota do Operacional compartilha os registros da rota do Suprimentos, mas usa permissão própria. **Resultado esperado:** a tela abre e apresenta **Registrar entrega** para quem pode alterar. Se a tela ainda não estiver publicada, aguarde a implantação antes de continuar.
2. **Usuário interno — Liberar o novo módulo, se estiver pendente.** Em **Administração › Módulos & Menus › Novos Módulos** (`/app/administracao?tab=modulos&visao=novos`), procure **Entrega de EPIs** do módulo **Operacional**. Se aparecer como pendente, use **Configurar acesso**, revise os usuários, setores e cargos selecionados e libere apenas os perfis previstos para o teste. Depois recarregue o ERP. **Resultado esperado:** o menu do Operacional fica disponível com permissão de visualizar e, para o operador do teste, alterar. Em 19/11/2026, esse módulo constava ativo, mas ainda pendente de liberação; confira novamente no dia do teste. Esta etapa requer acesso administrativo a **Novos Módulos**.
3. **Usuário interno — Escolher um caso real.** Defina contrato, posto, função, colaborador ativo no RH e um EPI que realmente será entregue, com estoque disponível. Confira que o cadastro do colaborador tem CPF válido e que a conta dele funciona no Portal do Colaborador. **Resultado esperado:** os dados do pedido poderão ser vinculados à pessoa que fará a confirmação no portal.
4. **Colaborador — Preparar o acesso pessoal.** Entre em `/colaborador` na sessão separada. Se em **Perfil › Segurança** (`/colaborador/perfil`) a conta ainda usar a senha inicial, escolha **Trocar senha** e defina uma senha pessoal. **Resultado esperado:** o perfil indica senha personalizada ativa. A confirmação eletrônica exige essa senha pessoal.

## Pedido, separação e retirada

5. **Usuário interno — Criar o pedido.** Acesse **Encarregados › Solicitar Materiais** (`/app/encarregados/solicitar-materiais`). Siga as etapas **Dados → Posto e Função → Materiais → Confirmação**. Escolha contrato e o colaborador existente na lista do RH; deixe **É admissão (colaborador novo)** desmarcado. Informe posto e função, selecione um item cadastrado como **EPI** em **EPIs e Insumos**, confira a quantidade e clique em **Enviar pedido**. **Resultado esperado:** um protocolo é gerado. Anote esse protocolo; não use apenas um insumo ou uniforme, pois a entrega digital consulta itens do tipo EPI.
6. **Usuário interno — Conferir e reservar.** Em **Suprimentos › Pedidos de Materiais** (`/app/suprimentos/pedidos-materiais`), localize o protocolo. Se estiver em **EM PREPARAÇÃO**, use **Conferir e reservar** e siga a conferência de estoque apresentada pelo ERP. **Resultado esperado:** o pedido entra na fila de separação com o EPI correto reservado. Se a reserva apontar falta ou divergência, resolva-a antes de prosseguir.
7. **Usuário interno — Confirmar a separação.** Em **Suprimentos › Separação de Pedidos** (`/app/suprimentos/separacao`), procure o protocolo, confira item, quantidade e lote e use **Confirmar tudo** (ou **Confirmar marcados**, caso a separação seja parcial). **Resultado esperado:** a separação é registrada, o estoque é movimentado e o pedido fica apto a seguir para retirada quando alcançar **Aguardando envio**. Registre o lote e o CA exibidos para compará-los com a ficha digital.
8. **Usuário interno — Registrar a retirada para entrega.** Acesse **Suprimentos › Retirada para Entrega** (`/app/suprimentos/retirada`) pelo QR da etiqueta ou digite o protocolo. Para um fluxo sem ficha de papel, responda **Não** em **O pedido possui Ficha de EPI física?**; responda à pergunta sobre crachá físico de acordo com o volume real. Clique em **Confirmar que retirei este pedido**. **Resultado esperado:** o pedido fica em **RETIRADO PARA ENTREGA**. Só pedidos em **Aguardando envio** podem ser retirados nessa tela. A resposta sobre ficha física descreve os documentos que acompanham o volume; ela não cria a comprovação eletrônica.

## Entrega e confirmação digital

9. **Usuário interno — Abrir o registro no Operacional no momento da entrega real.** Acesse **Operacional › Entrega de EPIs** (`/app/operacional/entrega-epi`), clique em **Registrar entrega** e busque o protocolo. Selecione o pedido e informe em **Responsável que entregou ao colaborador** o nome de quem realizou a entrega. Escolha **Confirmação pessoal no Portal do Colaborador** e clique em **Registrar entrega**. **Resultado esperado:** aparece um registro com situação **Aguardando confirmação**. O sistema monta a ficha com os itens de EPI efetivamente baixados, incluindo quantidade, lote e CA disponíveis no estoque. O pedido também pode estar em **DESPACHADO** para aparecer nessa busca.
10. **Usuário interno — Conferir antes da confirmação.** Abra o registro recém-criado e compare protocolo, colaborador, CPF, matrícula, empresa, contrato, posto, função, responsável, datas, EPI, quantidade, lote e CA com o pedido e com o material entregue. **Resultado esperado:** os dados correspondem à entrega real. Se houver diferença, interrompa o fluxo e registre o problema antes de pedir a confirmação ao colaborador.
11. **Colaborador — Localizar a entrega.** Na sessão do portal, acesse **EPIs** (`/colaborador/epis`) e atualize a página. Abra o card do mesmo protocolo e confira contrato, posto, responsável, EPI, quantidade, lote e CA. **Resultado esperado:** a entrega está disponível para a conta do colaborador correto, ainda sem data de confirmação. Ela só aparece após a ação **Registrar entrega** do usuário interno.
12. **Colaborador — Confirmar pessoalmente.** Após conferir os equipamentos recebidos, clique em **Conferir e confirmar recebimento**, leia a declaração, marque **Conferi os EPIs e confirmo a declaração acima.**, digite sua senha pessoal e clique em **Confirmar recebimento**. **Resultado esperado:** o portal mostra **Recebido e confirmado em** com data e hora e um identificador **SHA-256**. Essa é a confirmação eletrônica do colaborador; não há etapa de assinatura desenhada na tela.
13. **Colaborador — Guardar o comprovante.** No mesmo card, use **Imprimir / salvar PDF** para salvar o comprovante pelo diálogo de impressão do navegador. Se desejar conferir os dados estruturados, use **Baixar dados JSON**. **Resultado esperado:** o comprovante contém o protocolo, a identificação do colaborador, os EPIs, a declaração, o momento da confirmação e o identificador SHA-256. O botão de PDF fica disponível após a confirmação.
14. **Usuário interno — Conferir o retorno no ERP.** Atualize **Operacional › Entrega de EPIs**, busque o protocolo e abra o registro. **Resultado esperado:** situação **Confirmado pelo colaborador**, data e hora em **Confirmado**, identificador SHA-256 e opções **Imprimir / salvar PDF** e **Baixar dados JSON**. Com acesso à rota do Suprimentos, o mesmo registro também deve aparecer em `/app/suprimentos/entregas-epi`, pois as duas telas consultam a mesma entrega.
15. **Usuário interno — Conferir a ficha no histórico do pedido.** Volte a **Suprimentos › Pedidos de Materiais** (`/app/suprimentos/pedidos-materiais`), localize o protocolo e clique em **Histórico**. **Resultado esperado:** além dos eventos logísticos, aparece uma entrada **Ficha de EPI confirmada pelo colaborador** na data da confirmação. Clique em **Abrir / salvar PDF da ficha** e confira protocolo, colaborador, EPIs, declaração, data e identificador SHA-256. A confirmação no portal atualiza a **situação da entrega de EPI**; ela não muda automaticamente o status logístico do pedido.
16. **Usuário interno — Conferir o botão Ficha EPI.** No card do mesmo pedido, clique em **Ficha EPI**. **Resultado esperado:** aparece uma linha expansível para cada entrega digital registrada nesse pedido, com a situação **Aguardando confirmação** ou **Confirmada pelo colaborador**. Expanda a linha confirmada para ver os itens e abrir o PDF. Se houver duas ou mais entregas do mesmo pedido, cada uma deve ter sua própria linha e seu próprio comprovante; o histórico também deve ter uma entrada por confirmação. O **modelo para impressão sem confirmação digital** continua disponível por um botão separado nessa janela.

## Resultado a registrar

Preencha após o teste, sem publicar CPF, senha ou outros dados pessoais na PR:

| Verificação | Resultado |
| --- | --- |
| Protocolo do pedido de teste | |
| Pedido contém EPI e colaborador do RH correto | OK / Falhou |
| Separação e retirada concluídas | OK / Falhou |
| Registro no Operacional ficou **Aguardando confirmação** | OK / Falhou |
| Mesmo protocolo apareceu no portal da pessoa correta | OK / Falhou |
| Colaborador confirmou com senha pessoal | OK / Falhou |
| Portal exibiu data, hora e SHA-256 | OK / Falhou |
| Operacional e Suprimentos exibiram **Confirmado pelo colaborador** | OK / Falhou |
| Comprovante pôde ser salvo em PDF | OK / Falhou |
| Histórico do pedido exibiu a ficha confirmada e abriu o PDF correto | OK / Falhou |
| Botão **Ficha EPI** mostrou cada entrega digital do pedido | OK / Falhou |
| Ajuste necessário, mensagem de erro ou etapa divergente | |

## Se alguma etapa não aparecer

- **Menu do Operacional ausente ou sem Registrar entrega:** confira a liberação em **Novos Módulos**, a permissão de **visualizar/alterar** em **Entrega de EPIs** e recarregue o ERP.
- **Pedido ausente em Registrar entrega:** confirme status **RETIRADO PARA ENTREGA** ou **DESPACHADO**, existência de item do tipo **EPI** e vínculo com colaborador ativo no RH. O registro também exige EPI movimentado no estoque e ainda não incluído em outra entrega.
- **Erro ao registrar a entrega:** confira CPF válido no RH, correspondência de nome e matrícula com o pedido e existência de movimentação de estoque do EPI. Anote a mensagem exata para investigação.
- **Entrega ausente no portal:** confirme que o usuário interno já clicou em **Registrar entrega**, que o colaborador do pedido é o mesmo da conta autenticada e atualize **EPIs** no portal.
- **Portal pede senha pessoal:** use **Perfil › Segurança › Trocar senha** com a própria conta do colaborador e volte a **EPIs**. Se o registro foi criado em **Ficha física assinada e anexada**, ele seguirá o fluxo físico e não exibirá confirmação eletrônica.
- **PDF não abre:** após a confirmação, permita a janela de impressão do navegador e tente **Imprimir / salvar PDF** novamente.
- **Ficha digital ausente em Pedidos de Materiais:** confira se o mesmo protocolo foi usado em todo o fluxo, atualize a página e abra novamente **Histórico** ou **Ficha EPI**. Uma ficha pendente aparece no botão **Ficha EPI**, mas só entra no histórico de confirmações e libera o PDF após o colaborador confirmar.

O teste termina quando o colaborador encontra seu comprovante e o usuário interno vê a mesma entrega confirmada no ERP. Registre qualquer divergência no chamado **SIS-2026-0821** para ajuste final.
