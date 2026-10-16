# XepaJá - src

Fundacao Fase 0: app React servido pela API Hono, com PostgreSQL via Docker.

## Banco de dados

Persistencia em PostgreSQL 16 (imagem postgres:16-alpine). Suba antes de tudo:

- docker compose up -d db: sobe o Postgres local (volume xepaja-pgdata, porta 5432).
- Copie .env.example para .env e ajuste se preciso. DATABASE_URL aponta para o banco de dev; DATABASE_URL_TEST para o banco de teste dedicado (xepaja_test).
- A API e o watch aguardam o banco e rodam o migrate sozinhos; GET /api/health retorna db: up e 503 com db: down se o banco cair.

## Rodar

Todos os comandos a partir desta pasta (src), sempre com bun:

- bun install: instala dependencias.
- bun run watch: sobe back e front com live reload (aguarda o Postgres e roda o migrate antes). Abra http://localhost:3000. Equivale ao watch do uberpath, adaptado: API reinicia sozinha a cada save (bun --watch) e o front recompila a cada save (bun build --watch); o navegador recarrega sozinho em localhost.
- bun run watch:api: so a API com restart automatico.
- bun run watch:web: so o rebuild do front a cada save.
- bun run dev: build unico e sobe a API uma vez, sem watch.
- bun run build: build de producao do front em public/dist.
- bun test: recria o banco xepaja_test do zero (tools/reset-test-db.ts) e roda a suite contra ele, sem tocar no banco de dev.
- bun run db:migrate: cria ou atualiza o schema no banco da DATABASE_URL.
- bun run seed: cadastros de exemplo contra a API local (com o watch rodando).
- bunx tsc --noEmit: checagem de tipos.

Variaveis: PORT define a porta da API (padrao 3000). XEPAJA_URL e a URL publica usada pelo seed (padrao http://localhost:3000; na VPS, https://seu-dominio).

## Demo na VPS

- Exija portas 80/443 e DNS apontando para a VPS; defina DOMAIN e XEPAJA_URL=https://<dominio> no .env.
- docker compose -f compose.yaml -f compose.prod.yaml up -d --build: sobe db + app + Caddy (TLS automatico).
- Na VPS, rode o seed contra a URL publica: XEPAJA_URL=https://<dominio> bun run seed.

## Endpoints (Fase 1)

- POST /api/auth/signup com name, cpf, email, password, role e, para consumer, search_radius_km. Retorna 201 com o usuario e cookie de sessao.
- POST /api/auth/login com email e password. Erro sempre generico para nao revelar se o e-mail existe.
- POST /api/auth/logout encerra a sessao atual.
- GET /api/auth/me retorna o usuario da sessao ou 401.
- PATCH /api/users/me atualiza nome e, para consumer, o raio.
- GET /api/establishments/mine, POST /api/establishments e PATCH /api/establishments/mine (so merchant). Trocar o endereco exige GPS novo na mesma requisicao (422 sem ele). Resposta inclui can_publish e publish_block_reason.
- GET, POST /api/items e PATCH, DELETE /api/items/:id (so merchant, exige estabelecimento).
- POST /api/offers cria rascunho (so merchant com GPS). GET /api/offers/mine lista com itens, restante e estado derivado.
- POST /api/offers/:id/publish valida foto, composicao, preco e datas, congela endereco e GPS e vira publicada.
- PATCH /api/offers/:id edita livre sem reservas; com reservas ativas so orientacoes, resto volta 409.
- POST /api/offers/:id/encerrar e POST /api/offers/:id/cancel com reason (cascata com avisos, sem falta).
- POST /api/offers/:id/photo com multipart campo photo (jpeg, png, webp, ate 5 MB). GET /api/offers/:id/photo serve o arquivo.
- GET /api/offers/nearby com lat, lng e radius_km opcional (padrao o raio da conta). So publicadas vigentes dentro do raio, ordenadas por distancia, com distance_km.
- GET /api/offers/:id com detalhe e composicao. Publicada abre a qualquer autenticado; rascunho alheio volta 404.
- POST /api/reservations com offer_id e idempotency_key (so consumer, bloqueado volta 403). Confirmada direta sem faltas com codigo unico; pendente de 30 minutos com 1 ou 2 faltas.
- GET /api/reservations/active e /history com limites, faltas e bloqueio. POST /api/reservations/:id/cancel no prazo sem falta.
- GET /api/reservations/incoming e POST /:id/accept, /:id/refuse e /:id/merchant-cancel com motivo (so merchant dono).
- GET /api/notices com nao lidos e POST /api/notices/:id/read.
- POST /api/reservations/pickup/confirm com code (so merchant dono). Uso unico, tolerancia de 15 minutos apos o fim, aviso ao consumidor.
- GET /api/push/vapid-key, POST /api/push/subscribe e /unsubscribe por aparelho (so autenticado). Todo aviso tenta push sem bloquear; o aviso interno e o fallback.
- POST /api/auth/password/forgot responde sempre igual; POST /api/auth/password/reset com token unico de 1 hora, uso unico, mata sessoes. Sem e-mail no MVP: o codigo sai no log do servidor.

## NFR e deploy

- A API valida tudo no servidor; o front so antecipa formato.
- GPS do consumidor vai so por query no nearby e nunca e persistido.
- Dev local em http; producao exige HTTPS com terminacao TLS a frente do `bun src/api/index.ts`.
- Carga local medida em ~130 ms; meta de 3 s com folga em rede local.

## Estrutura

- src/api: backend Hono e PostgreSQL (db.ts com schema e migrate, index.ts com rotas e estaticos).
- src/web: frontend React (main.tsx, App.tsx).
- src/shared: tipos usados pelos dois lados.
- public: shell PWA (index.html, manifest.webmanifest, sw.js, offline.html, styles.css, icons).
- public/dist: bundle gerado, nao versionar o conteudo, apenas o diretorio via gitkeep se preciso.
- tools/dev.ts: orquestra o watch duplo. tools/build.ts: build de producao.
- tests: testes com bun test.

## Notas de PWA e offline

Sem rede nao ha confirmacao de reserva: a API e a fonte da verdade e o service worker nunca responde /api do cache. Navegacoes offline caem em offline.html.
