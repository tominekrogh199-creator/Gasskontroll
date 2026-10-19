# Kontrollplan

iPhone-først nettapp for én kontrollør av gassanlegg: fristoversikt, kvartalsplan med kjøreruter,
varsler med godkjenning og import av kontrollrapporter. Prototype – se «Ekte og simulert» under.

## Kom i gang

```bash
npm install
npm run dev      # utviklingsserver, åpne adressen på iPhone i samme nett
npm run build    # typesjekk + produksjonsbygg til dist/
npm run preview  # server dist/
npm test         # 25 tester (vitest)
```

Appen starter med 60 fiktive anlegg regnet ut fra dagens dato. Testdato og «Nullstill demodata» ligger i
Innstillinger (tannhjulet på Hjem).

## Struktur

- `src/domain/` – ren logikk uten UI: datamodell, statusflyt, datoer/helligdager/virkedager, planlegger
  (nærmeste nabo + 2-opt), varsler, rapporttolking, import.
- `src/adapters/` – alt eksternt bak fire adaptere: `extractReport`, `getDriveTime`, `geocode`, `sendEmail`
  (+ `pdfText` for pdf.js).
- `src/ui/` – Preact-skjermer: Hjem, Kart, Plan, Anlegg, Innboks, Innstillinger.
- `tests/acceptance.test.ts` – akseptansetestene mot domenelogikken.

## Ekte og simulert

- Ekte: fristlogikk, statusflyt med logg, virkedager med norske helligdager, planlegging og tidslinjer,
  PDF-tekstuttrekk lokalt med pdf.js, regex/regelbasert tolking, CSV, lagring i nettleseren (localStorage).
- Simulert: kjøretid (luftlinje × 1,4 ÷ 70 km/t + 5 min), geokoding (innebygd tabell over steder og
  postnumre, merket «ca.»), kart (forenklet vektorkart uten kartfliser), e-post (åpner e-postappen via
  mailto, merkes sendt først når du bekrefter).
- AI: brukes bare hvis du legger inn en Anthropic API-nøkkel i Innstillinger. Uten nøkkel: regelbasert
  uttrekk og manuell gjennomgang.
