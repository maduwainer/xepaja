# XepaJá - AGENTS.md

Panorama do projeto, escopo do MVP, regras e planejamento. Documento vivo: atualizar a secao de status conforme o trabalho avanca. Evitar aqui versoes de libs e detalhes que mudam a cada install; o que importa e comportamento e contrato.

Documento de requisitos original esta com o dono do projeto, fora deste repo. Ele e a referencia de negocio (glossario, RF, RN, RNF, CA). Em caso de conflito entre este AGENTS.md e o codigo em src, vale o codigo. Em caso de conflito sobre intencao de negocio, vale o documento original.

## O que e

XepaJa e um Progressive Web App para conectar feirantes e mercearias locais a moradores da regiao. O comerciante publica ofertas de alimentos ainda proprios para consumo ao fim do expediente (com desconto ou gratis) e o consumidor reserva uma unidade e retira presencialmente.

Dois perfis, sem perfil operacional no MVP:

- Comerciante: feirante ou mercearia. Administra estabelecimento, cadastra itens, publica ofertas, decide sobre pedidos pendentes, confirma retirada presencial, encerra ou cancela ofertas.
- Consumidor: morador. Escolhe raio de busca, usa localizacao atual para achar ofertas proximas, pede uma reserva por vez, cancela dentro do prazo, apresenta codigo na retirada.

Negociacao financeira, quando houver, acontece presencialmente fora do aplicativo. O app nao cobra, nao processa e nao confirma pagamentos.

## Stack imposta

Nao trocar sem falar com o dono do projeto:

- Runtime e tooling sempre com bun, nunca node/npm direto para este projeto. Scripts, dev server, testes, migrations e seeds rodam via bun.
- Frontend em React. Deve funcionar em navegador movel e ser instalavel como PWA onde houver suporte.
- Backend/API em Hono. Toda regra de negocio critica (autorizacao, disponibilidade, 1 reserva ativa, bloqueio de 10 dias, faltas, expiracao) e validada no servidor, nunca so no cliente.
- Persistencia em PostgreSQL via Docker (imagem postgres:16-alpine, compose.yaml na pasta src). Nao usar sqlite, mysql ou outro banco para persistir dados do servidor. Transacoes no banco para atomicidade de reserva e auditoria de transicoes. SQLite segue admitido apenas como eventual cache local futuro no cliente para o PWA offline, sem codigo para isso nesta entrega.
- PWA com HTTPS, manifesto e service worker, mais tela de indisponibilidade quando a conexao cair. Reserva e alteracao de estoque exigem confirmacao online; sem rede nao ha confirmacao falsa.

Codigo do projeto fica em src/api, src/web e src/shared; ferramentas em tools, testes em tests, shell PWA em public. Documentacao de referencia fica em docs.

## Meta de DX: bun run watch

Requisito de fluxo de desenvolvimento, espelhado no watch do projeto irmao uberpath (script watch em package.json que delega para tools/build.ts com --watch), adaptado para a stack XepaJa:

- A partir da raiz do repo, o comando bun run watch sobe back e front juntos com live reload: a API Hono reinicia sozinha a cada save via bun --watch e o front React recompila a cada save via bun build --watch para public/dist.
- O navegador recarrega sozinho em localhost por um poller embutido em public/index.html que observa o bundle; em producao ele fica inativo.
- Comandos de apoio: bun run watch:api (so API), bun run watch:web (so rebuild do front), bun run dev (build unico sem watch), bun run build (build de producao), bun test (recria o banco xepaja_test do zero a cada rodada via tools/reset-test-db.ts, sem tocar no banco de dev), bun run db:migrate, bun run seed (cadastros de exemplo, com o watch rodando). Antes de tudo: docker compose up -d db e .env a partir de .env.example (DATABASE_URL de dev, DATABASE_URL_TEST de teste). O watch aguarda o Postgres e roda o migrate sozinho; GET /api/health confere o banco (db: up, ou 503 com db: down).
- Orquestracao em tools/dev.ts: dois processos com logs herdados e encerramento conjunto em SIGINT ou SIGTERM.
- Seed de demonstracao em tools/seed.ts, via `bun run seed` com o watch rodando: cria 10 contas demo prefixadas (3 comercio- e 7 cliente-), 3 estabelecimentos com GPS, 15 itens e 6 ofertas (5 publicadas com foto + 1 rascunho sem foto). Cada item tem foto casual de celular em public/seed-photos/<item>.jpg (geradas via skill imagegen, parte do seed); a foto da oferta usa a do item principal e o seed so envia quando falta ou ainda e placeholder antigo, entao foto real do comerciante nunca e trocada. Cobre todas as situacoes de solicitacao: confirmada, pendente, recusada, cancelada pelo consumidor, cancelada pelo comercio, expirada sem falta, expirada com falta, retirada; e de oferta: rascunho, publicada, esgotada, encerrada, cancelada; mais consumidor bloqueado por 3 faltas. Idempotente, pode rodar de novo sem duplicar; escritas fora da API so para cenario impossivel no relogio real (1 falta inicial, relogio adiantado para expiracoes, bloqueio), marcadas no codigo. Fotos do seed sao de exemplo em public/seed-photos; o comerciante troca pela sua em "Trocar foto". Os botoes de demonstracao na tela Entrar (src/web/AuthForm.tsx, DEMO_ACCOUNTS) devem acompanhar as contas do seed.
- Mapas com Leaflet 1.9.4 via CDN (CSS e JS com integrity em public/index.html, versao pinada porque a API do mapa e critica) em src/web/MapView.tsx: busca com pinos das ofertas mais posicao da busca, detalhe da oferta com ponto de retirada, estabelecimento com ponto publicado. Ladrilhos OpenStreetMap com atribuicao; sem rede para o mapa mostra texto e o resto segue funcionando. Posicao do consumidor vive so na memoria da busca.
- Versao do cache do shell em public/sw.js (CACHE xepaja-vN): aumentar sempre que index.html, styles.css, offline.html ou manifest mudarem, senao o SW serve o shell antigo e trava atualizacao. Mudanca de shell pede teste de sintaxe do sw (tests/sw.test.ts) mais conferencia no Chrome de que a nova versao assumiu.
- Manutencao do seed: ao mudar fluxos, validacoes, formatos ou regras (ofertas, reservas, faltas, fotos), atualizar tools/seed.ts junto e rodar `bun run seed` para provar. Janelas de oferta do seed sao relativas ao agora para continuarem vigentes.
- Todo servico novo deve funcionar sob esse fluxo: nada que exija node direto, bundler externo ou passo manual fora do bun para ver a alteracao no navegador.

## Conceitos centrais

- Oferta: anuncio de alimento ou caixa para retirada. Tipo item ou caixa surpresa. Caixa surpresa lista itens selecionados e quantidade de cada item por caixa, mais foto, preco por caixa ou gratis, janela de retirada e orientacoes de conservacao. Conteudo entregue deve corresponder ao anunciado.
- Unidade: cada reserva corresponde a uma unidade da oferta. A quantidade total publicada indica quantas reservas podem ser atendidas.
- Janela de oferta: periodo em que novos pedidos sao aceitos. Janela de retirada: periodo de entrega presencial. A janela de retirada nao pode terminar antes do inicio da oferta.
- Reserva ativa: pedido pendente ou reserva confirmada. Cada consumidor pode ter no maximo uma por vez. Estados concluidos nao impedem futuras reservas, salvo bloqueio.
- Falta: reserva confirmada que expirou sem retirada apos tolerancia de 15 minutos apos o fim da janela. Cancelamento dentro do prazo nao conta como falta. Cancelamento de oferta pelo comerciante nao conta como falta.
- Bloqueio: apos a terceira falta desde o ultimo desbloqueio, o consumidor fica 10 dias sem poder criar novas reservas, contados da expiracao que gerou a terceira falta. Ao fim do bloqueio inicia-se nova contagem.
- Codigo de retirada: cada reserva confirmada tem um codigo unico de uso unico, apresentado pelo consumidor. O comerciante informa o codigo para registrar a entrega. Uma reserva so pode ser concluida uma vez. Registro permitido durante a janela e ate 15 minutos apos.
- Posicao GPS do estabelecimento: capturada no local de retirada antes de publicar ofertas. Alterar endereco exige recapturar GPS e vale so para ofertas futuras; reservas existentes mantem local, preco, composicao e prazo aceitos (snapshot no pedido).
- Localizacao do consumidor: usada somente no momento da busca, mediante permissao, comparada a posicao registrada do estabelecimento para filtrar pelo raio. Sem permissao ou sem fix, explicar, oferecer nova tentativa e manter conta e historico acessiveis. Nao fazer tracking continuo, nao usar endereco residencial para busca, nao armazenar posicao do consumidor no perfil. O consumidor nao cadastra endereco residencial; so escolhe raio maior que zero e ate 100 km.

## Ciclos de vida

Oferta: rascunho, publicada, esgotada ou encerrada; tambem pode ser cancelada ou expirar. Encerrada, cancelada, esgotada ou expirada nao aceita novas reservas. Esgotada pode voltar a ficar disponivel apos cancelamento de reserva somente antes do fim da janela; retirada efetivada nao repoe quantidade.

Reserva sem faltas: pedido vai direto para confirmada. Reserva de quem tem uma ou duas faltas: pedido fica pendente de decisao do comerciante por ate 30 minutos, sem ultrapassar o fim da janela de retirada, depois expira sem falta e libera a unidade se a oferta ainda aceitar reservas. Pendente pode terminar em confirmada, recusada, cancelada ou expirada. Confirmada pode terminar em retirada, cancelada ou expirada sem retirada (gera falta apos tolerancia). Pendente que expira nao conta falta. Decisao do comerciante apos expiracao nao altera o pedido.

Unidade solicitada fica indisponivel enquanto pendente ou confirmada. Recusa, cancelamento e expiracao so repoem disponibilidade enquanto a oferta estiver vigente, sem exceder o total publicado. Quantidade disponivel = quantidade publicada menos pendentes, confirmadas e retiradas.

## Escopo do MVP

Inclui:

- Contas com nome, CPF, e-mail e senha, validacao de obrigatorios, e-mail unico, autenticacao, encerramento de sessao, consulta e atualizacao de nome e contato, restricao de publicacao e gestao de reservas ao comerciante responsavel.
- Estabelecimento com nome, tipo (feira ou mercearia), CNPJ se tiver, endereco escrito de retirada, referencia, horario de funcionamento, mais GPS capturado no local. Cadastro de itens do estabelecimento com nome e unidade para compor ofertas.
- Ofertas com titulo, tipo, foto obrigatoria, itens com quantidade positiva por unidade, quantidade de unidades ofertadas positiva, preco nao negativo ou gratuidade com indicacao Gratis, endereco e GPS de retirada snapshotados, janelas de disponibilidade e retirada coerentes, orientacoes de conservacao. Publicar, consultar, encerrar, cancelar. Edicao livre sem reservas; com reservas so foto e complementos que nao alterem item, quantidade, valor, local e horario; mudanca material exige cancelar e avisar. Exibir quantidade restante e estado; nao mostrar como disponivel oferta com janela terminada.
- Descoberta por proximidade com raio ate 100 km, lista com titulo, tipo, preco ou gratuidade, comerciante, distancia estimada, janela de retirada e disponibilidade; detalhe com foto, composicao, unidades disponiveis, preco, endereco, periodo e orientacoes antes do pedido.
- Reserva de uma unidade com retencao atomica, informando estado, prazo, identificador e condicoes. Consulta de reserva ativa e historico com estado, quantidade, local, prazo, faltas e fim do bloqueio quando aplicavel. Cancelamento de pendente antes de expirar e de confirmada ate 15 minutos antes do fim da janela, com limite visivel antes da confirmacao e no detalhe.
- Gestao do comerciante: ver solicitacoes com indicador de uma ou duas faltas, aceitar ou recusar pendentes com motivo, cancelar confirmada com motivo e aviso, confirmar retirada pelo codigo. Motivo registrado ao recusar ou cancelar; quantidade volta a oferta so se ela ainda aceitar reservas.
- Expiracao e faltas: ao fim da janela expirar pendentes nao decididos; confirmadas sem retirada ficam 15 minutos para registro e depois expiram e contam falta; terceira falta bloqueia 10 dias.
- Comunicacao: avisos internos para pendente, aceita ou recusa, confirmacao, cancelamento, expiracao de pendente, aproximacao do prazo e bloqueio, sempre identificando oferta ou reserva. Push para os mesmos eventos quando houver permissao e suporte; sem permissao ou suporte os avisos internos mantem a informacao e a reserva funciona.
- Suporte: mensagens claras para campo invalido, esgotada, sessao encerrada, sem conexao e falha na reserva; redefinicao de senha por e-mail com link ou codigo de uso unico, com validade, sem revelar se o e-mail existe.

Fora do escopo nesta primeira versao: processamento de pagamentos, entregas, chat, avaliacoes, gamificacao, gestao financeira, controle completo de estoque, integracao com caixa ou estoque, emissao de documentos fiscais, inteligencia artificial, relatorios avancados, moderacao de anuncios, atendimento a incidentes pela plataforma, apps moveis nativos. O MVP inclui os servicos de recuperacao por e-mail e notificacoes push.

## Regras de negocio que nao podem quebrar

- Disponibilidade calculada no servidor, retencao atomica de unidade em pendente e confirmada, sem overbooking mesmo com pedidos simultaneos. Reenvio apos falha de rede nao cria pedido duplicado (idempotencia).
- Uma reserva ativa por consumidor, verificada no servidor, incluindo checagem de bloqueio de 10 dias no servidor.
- Somente o comerciante responsavel altera a propria oferta, aceita ou recusa pendentes da sua oferta, cancela reservas da sua oferta e confirma retiradas. Somente o titular cancela seu pedido ou reserva.
- Snapshot da reserva: consumidor, oferta, quantidade, valor e condicoes de retirada vigentes no pedido ficam registrados e nao mudam com edicao posterior do estabelecimento.
- Oferta gratuita exibe valor zero e Gratis.
- Comerciante declara que o alimento esta proprio e informa conservacao; o app registra a declaracao sem certificar seguranca do alimento e mantem a oferta indisponivel apos o prazo.
- Auditoria de data, hora e agente em transicoes de ofertas e reservas.
- Distancia estimada a partir da localizacao atual e do GPS do estabelecimento; exibe oferta quando distancia <= raio. Sem GPS do estabelecimento nao publica; sem localizacao do consumidor nao apresenta resultados por proximidade.
- Codigo usado nao conclui outra reserva nem registra a mesma retirada duas vezes.

## Requisitos nao funcionais

- Acessibilidade: telas essenciais operaveis por teclado, foco visivel, rotulos acessiveis, contraste legivel, erros associados aos campos, validacao com leitor de tela em ao menos um fluxo de cada perfil.
- Responsividade: cadastro, busca, detalhe, reserva, publicacao e confirmacao funcionam de 320 px ate desktop sem rolagem horizontal para acoes essenciais.
- PWA instalavel onde houver suporte, com offline screen; nada de sucesso falso offline.
- Seguranca: nada de senha em texto puro, tudo por HTTPS, autorizacao no servidor, entradas validadas, sessoes com expiracao e logout.
- Privacidade: localizacao so para registrar ou atualizar posicao do estabelecimento e na busca por proximidade; CPF, endereco do estabelecimento, historico, faltas e dados de reserva so para finalidades da plataforma; comerciante ve so o necessario para decidir e entregar; informar uso dos dados e permitir solicitar exclusao de conta observadas obrigacoes aplicaveis.
- Desempenho: meta inicial de teste com resposta util em ate 3 segundos em lista, detalhes e reservas em conexao movel estavel com dados representativos; revisar apos primeiro prototipo funcional.
- Compatibilidade: fluxos essenciais testados nas versoes atuais de dois navegadores moveis e um desktop escolhidos pela equipe; sem push o app continua com avisos internos.

## Criterios de aceitacao do MVP, resumo para testes

Espelham o PDF; usar como checklist de QA antes de declarar pronto:

- CA oferta: so publica com foto e ao menos um item com quantidade positiva; faltando obrigatorio mostra mensagem especifica; composicao visivel no detalhe.
- CA busca por raio: com localizacao e raio ate 100 km mostra so ofertas dentro do raio; sem localizacao informa motivo, permite tentar de novo, nao mostra por proximidade, conta e historico seguem acessiveis.
- CA concorrencia e 1 ativa: com uma unidade restante dois pedidos simultaneos nao reservam mais de uma; quem ja tem pendente ou confirmada nao cria outra.
- CA faltas e pendencia: com uma ou duas faltas o pedido fica pendente, comerciante aceita ou recusa, quantidade retida e liberada na recusa se oferta vigente, retirada nao repete.
- CA notificacoes: com permissao e suporte gera push e aviso interno; sem gera so aviso interno e reserva funciona.
- CA a11y, offline e senha: publicacao e reserva no celular com teclado e rotulos; sem rede sem confirmacao falsa; recuperacao com token de uso unico sem revelar existencia da conta.
- CA bloqueio: terceira falta bloqueia 10 dias; ao fim pode reservar e contagem reinicia.
- CA GPS: com GPS publica, sem GPS nao; busca usa posicao atual, mostra distancia, so inclui dentro do raio; sem localizacao informa e permite tentar de novo.
- CA pendente expira: sem resposta em 30 minutos ou ate fim da retirada expira, libera unidade quando aplicavel, permite nova reserva, sem falta.
- CA codigo e tolerancia: codigo correto conclui uma vez; entrega ate 15 minutos apos a janela nao gera falta; sem registro apos tolerancia expira e gera falta.
- CA cancelamento: antes do limite cancela confirmada sem falta; depois do limite impede; pendente cancela antes de expirar.
- CA cancelar oferta: encerra pendentes e confirmadas nao retiradas, avisa, sem faltas.
- CA multiplas unidades: com tres caixas no maximo tres consumidores reservam uma cada; cada reserva mostra preco e composicao por caixa.

Nota: a numeracao de RF no PDF tem duplicidades (existem dois RF-23 e RF-17 repete RF-20). Seguir a intencao descrita acima, nao o numero literal.

## Planejamento e status

Status em 2026-10-16: Fases 0 a 7 feitas e verificadas, MVP completo, mais migracao SQLite para PostgreSQL feita e verificada (cutover total com postgres.js, compose com db + app e override com Caddy para TLS na VPS, 51 testes verdes, seed recriado do zero e idempotente, smoke de login, bloqueio, nearby e reserva). Proximo passo: deploy na VPS com o dominio da demonstracao. Fase 7 rodou a QA final: teclado com skip link, aria-pressed e live regions, alvos de 44 px e foco visivel; matriz 360, 768 e 1280 sem scroll horizontal; carga local em ~130 ms com folga na meta de 3 s; GPS do consumidor nunca persistido (0 linhas com gps em reservas, sem coluna de coords em users); sem URLs http hardcoded, TLS fica para o deploy; 50 testes, tsc e build limpos mais smoke E2E de todas as telas do comerciante sem erros de console. Proximo passo: deploy com HTTPS e provedor de e-mail para o reset de senha.

Ordem sugerida, cada fase com criterio de pronto ligado aos CA:

- Fase 0 fundacao (feita em 2026-10-11): layout em src com app React, API Hono e schema sqlite mais migrations e seeds; scripts bun para dev, teste, migrate e seed; base PWA com HTTPS, manifesto e service worker; tela offline. Criterio atingido: bun run watch sobe a API e rebuilda o front com live reload, /api/health responde, estaticos e fallback SPA funcionam, migrate abre limpo.
- Fase 1 contas e estabelecimento (feita em 2026-10-11): cadastro e login com hash, sessao com expiracao e logout, update de perfil, CRUD de estabelecimento com GPS obrigatorio para publicar, cadastro de itens. Criterio atingido: sem GPS o can_publish volta falso com motivo, consumidor cria conta sem endereco so com raio, consumidor recebe 403 em rotas de comerciante.
- Fase 2 ofertas (feita em 2026-10-11): criacao com todas validacoes, foto obrigatoria, edicao restrita com reservas, encerrar e cancelar com motivo e avisos sem falta, snapshot de local e preco na reserva, lista com quantidade restante e estado. Criterio atingido: sem foto o publish volta 422 e o botao fica desabilitado, sem GPS nao cria, edicao material com reservas ativas volta 409, cancelar exige motivo e zera sem falta. Fotos em data/uploads (ignorado no git), gratis exige preco zero.
- Fase 3 descoberta (feita em 2026-10-11): busca por raio com permissao, distancia estimada, lista e detalhe. Criterio atingido: dentro do raio aparece com distancia e fora nao aparece, expirada e rascunho nao listam, sem localizacao volta 400 com mensagem e nova tentativa na tela, foto abre a qualquer autenticado em qualquer estado e detalhe de rascunho alheio segue 404. Vigente = publicada com janela aberta e retirada nao terminada; posicao do consumidor nunca persistida.
- Fase 4 reservas (feita em 2026-10-11): uma ativa por consumidor, retencao atomica, idempotencia, pendente de 30 minutos para quem tem 1 ou 2 faltas com aceite ou recusa, cancelamento com limites visiveis. Criterio atingido: 1 unidade com 2 pedidos simultaneos atende so 1, reenvio com mesma chave nao duplica, pendente expira sem falta e decisao tardia nao altera, cancelada no prazo sem falta e fora do prazo bloqueia, terceira falta bloqueia 10 dias com aviso, recusa e cancel do comerciante exigem motivo. Codigo de uso unico com hash, mostrado uma vez na criacao e no aceite.
- Fase 5 retirada e faltas (feita em 2026-10-11): codigo unico de uso unico, confirmacao uma vez, tolerancia de 15 minutos, contagem de faltas, bloqueio de 10 dias com nova contagem apos, job de expiracao com auditoria. Criterio atingido: codigo confirma uma vez e reuso volta 404 sem vazar, dentro da tolerancia confirma e alem dela expira com falta, multiplas unidades retiram e a seguinte nao reserva, estoque segue retido apos retirada, papeis respeitados. Expiracao e preguicosa em cada leitura e escrita com auditoria, sem runner separado.
- Fase 6 comunicacao e senha (feita em 2026-10-11): avisos internos para todos os eventos, push com fallback, recuperacao de senha com token unico e sem oracle de e-mail. Criterio atingido: todo evento gera aviso interno e tenta push sem bloquear, sem inscricao ou com push falho o aviso continua, aproximacao do prazo avisa uma vez, forgot responde igual exista ou nao, reset de uso unico com expiracao mata sessoes antigas. Chaves VAPID em data/vapid.json fora do git.
- Fase 7 NFR e QA final (feita em 2026-10-11): teclado e leitor de tela, responsivo 320 px sem scroll horizontal em acoes essenciais, HTTPS em tudo, validacao server-side, privacidade de localizacao, meta de 3 segundos, matriz de 2 moveis mais 1 desktop, rodada completa dos CA. Criterio atingido: suite e tipos e build limpos, matriz 360/768/1280 sem overflow, carga local ~130 ms, GPS nunca persistido, smoke E2E sem erros. HTTPS de producao via terminacao TLS no deploy, fora do app.

## Regras de desenvolvimento para este projeto

- Usar bun para tudo: bun run, bun test, bunx para scaffolds. Nao introduzir package-lock nem fluxo que exija node direto.
- Manter o bun run watch funcionando: qualquer mudanca no servico de arquivos estaticos, nas rotas ou no entry do front deve continuar entregando restart da API e rebuild do front com reload no navegador, sem passo manual extra.

## Testes com Playwright MCP

Regra de QA para este projeto: todo teste de interface passa pelo Playwright MCP (`playwright`, config versionada em .pi/mcp.json), nunca pelo Chrome MCP e nunca por curl sozinho para fluxos de tela.

- URL base sempre http://localhost:3000. Assumir que bun run watch ja esta rodando no terminal do dono (API com restart automatico e front com rebuild e reload). Nunca subir um segundo servidor na porta 3000; antes de testar, conferir GET http://localhost:3000/api/health. Se estiver fora do ar, pedir ao dono para subir o watch em vez de ocupar a porta.
- Ferramentas no namespace `mcp__playwright__`, chamadas via script codemode: `browser_navigate` para abrir a URL, `browser_snapshot` para ler a arvore de acessibilidade e localizar elementos por ref, `browser_click`, `browser_type` e `browser_fill_form`, `browser_press_key`, `browser_wait_for` para aguardar textos apos acoes, `browser_take_screenshot` para conferencia visual, `browser_network_requests` para depurar chamadas a API, `browser_console_messages` para erros de console.
- Pre-requisitos de quem clona: bun, Node com npx, navegador Chrome instalado e o agent pi. Na primeira abertura do projeto, conceder trust para ativar .pi/mcp.json e conferir em /mcp que `playwright` conectou (`chrome-devtools` vem desabilitado neste projeto).
- Preferir snapshot a screenshot para afirmar estado; usar screenshot para layout e responsivo.
- Apos cada alteracao no codigo, dar tempo do rebuild do watch antes de afirmar (a pagina recarrega sozinha em localhost).
- O perfil do navegador e temporario e isolado: nada persiste entre sessoes. Criar usuarios de teste novos a cada rodada via signup com e-mails unicos; nao depender de conta fixa que pode colidir com outra sessao.
- Frontend React com rotas por perfil e telas para cadastro, busca, detalhe, reserva, publicacao e confirmacao de retirada; forms com labels, foco visivel e erros ligados aos campos.
- API Hono como unico lugar que decide estoque, faltas e bloqueio; cliente nunca confia em estado local para essas decisoes.
- PostgreSQL com transacoes em reserva (SELECT ... FOR UPDATE na oferta), aceite, recusa, cancelamento, expiracao e retirada; checagem de idempotencia para reenvio; registro de data, hora e agente; migrate idempotente e seeds para os testes de CA. Datas em TIMESTAMPTZ normalizadas para ISO no driver; COUNT com ::int.
- Fotos de oferta sao obrigatorias e ficam em data/uploads (ignorado no git); o banco guarda so o caminho. Limite de 5 MB, apenas jpeg, png e webp. Servidas em GET /api/offers/:id/photo.
- GPS: pedir posicao do estabelecimento no local de retirada e do consumidor somente na busca; tratar negacao com mensagem e nova tentativa; nunca persistir posicao do consumidor.
- Push depende de permissao e suporte; avisos internos sao a fonte garantida e devem conter a mesma informacao.
- Mensagens de erro claras, sem afirmar sucesso antes da confirmacao do servidor.
- Manter este AGENTS.md atualizado: mover fase para feita somente com CA correspondente verificado; nao colar aqui versoes, dumps de schema ou listas de arquivos que mudam toda hora.

## Convencoes gerais

- Usar forward slashes / em todos os paths, inclusive no Windows: codigo, comandos, buscas e links em markdown. O Windows aceita / normalmente e isso mantem tudo portatil.
- Nao usar negrito ou italico em arquivos markdown.
- Scripts one-off e experimentos vao em tmp/ e rodam de la, de preferencia com TypeScript e Bun. Nao espalhar scripts avulsos pelo repo; tmp/ e ignorado no git.
- No Git Bash do Windows, usar python ou py -3, nunca python3 (o stub da Microsoft Store quebra).
