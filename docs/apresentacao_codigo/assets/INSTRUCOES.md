# Como reconstruir a apresentação

Tudo mora em `docs/apresentacao_codigo/`:

- `assets/slides.md`: roteiro de fala por slide (o que dizer em cada um).
- `assets/prints/01..06`: fotos do app em 390 px, tiradas do Chrome mobile.
- `assets/build_pptx.py`: textos, diagrama e layout; gera o `.pptx`.
- `XepaJa_MariaEduardaWainer_PWA.pptx`: saída gerada (não edite à mão).

## Reconstruir

Na raiz do repo xepaja, sem instalar nada fixo (uv cria ambiente isolado):

    uv run --with python-pptx --with pillow docs/apresentacao_codigo/assets/build_pptx.py

## Ajustar textos

Edite as funções `add_slide`/`code_slide`/listas em `build_pptx.py`
e o roteiro em `slides.md`, depois rode o comando acima.

## Regra de layout (não quebrar)

Listas de bullets usam UMA única caixa de texto por lista, com um
parágrafo por item (`bullets()` já faz isso). Nunca crie uma caixa por
bullet: a estimativa de quebra de linha erra conforme fonte e largura,
e as caixas se sobrepõem no slide (foi o bug da v1). Se o texto crescer,
aumente a altura da caixa única em vez de fatiar em caixas.

## Refazer os prints

1. `bun run watch` e `bun run seed` com o banco local no ar.
2. No Chrome, janela de 390 x 844, http://localhost:3000.
3. Cadastro: aba Criar conta, digite nome e CPF e fotografe sem enviar.
4. Busca: entre como cliente-zeca, emule a posição (-15.6, -56.1),
   clique em Buscar perto de mim e fotografe a lista.
5. Detalhe, reserva (código aparece na tela), Conta (slider) e
   comerciante (comercio-banca) na sequência do fluxo.
6. Salve como `assets/prints/01..06` e rode o build de novo.
