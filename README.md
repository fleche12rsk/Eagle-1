# Bota Ultra-Garganta 3000

Sintetizador de trato vocal que roda no navegador. Uma fonte glotal LF excita um guia de onda Kelly-Lochbaum cujo formato sai de parâmetros anatômicos (língua, mandíbula, lábios).

```bash
npm install
npm run dev     # servidor de desenvolvimento
npm test        # testes do DSP (NaN, teto de saída, estalos, formantes das vogais, CPU)
npm run build   # build de produção em dist/
```

- `src/dsp/`: motor de síntese puro (sem DOM), testado em Node.
- `src/worklet/processor.ts`: AudioWorklet que embrulha o motor.
- `src/ui/`: knob acessível, teclado, pad de vogais, desenho do trato, osciloscópio.

O Pink Trombone (Neil Thapen, licença MIT) foi estudado como referência do algoritmo; o código aqui é próprio.

© 2026 Bota Ultra-Garganta 3000. Todos os direitos reservados a [Micio](https://micio.dev/).
