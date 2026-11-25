# Pravidla RŽL a jejich ověření

Ověřeno na oficiálních tabulkách `doc/source/RZL_2024*.pdf` (2024/25, konečné) a `RZL_26_27*.pdf` (2026/27 po 3 kolech)
proti datům z chess-results. Test: `shared/__tests__/rzl.test.ts`.

## Struktura
- Sezóna = seed turnaj (A, 1. kolo). Jeho detail („Výběr turnaje“) obsahuje všechna kola × A/B/C, název `Místo X`.
  2025/26: seed 1250588, 9 kol × 3 = 27 turnajů. 2026/27: seed 1492587.
- Hráč hraje v kole jeden z turnajů A/B/C (švýcar, A 4 kola, B/C 7 kol).

## Body a pořadí — ověřeno ✅
- Body za kolo: **A = 2 × body + 5, B = body + 2, C = body** (sedí u všech 120+ hráčů 2026/27).
- Umístění v kole: jen hráči regionu, pořadí A, pak B navazuje, pak C.
- Celkem: **5 nejlepších** výsledků (z 8 v 2024/25, z 9 od 2025/26); při rovnosti bodů rozhoduje **menší součet umístění**
  započítaných výsledků. Ruční tabulka obsahuje drobné překlepy v umístění (např. 2026/27 Říčany C: 35. → 101, 37. → 99).
- Hráči mimo region se do pořadí ani umístění nepočítají (2026/27: SK OAZA Praha, TJ Neratovice, Šachy Polabí;
  neregistrovaní s místem Praha, Kralupy, Kunice, Magic hill, Benešov). V ruční tabulce chybí i pár regionálních hráčů
  (3 hráči) — aplikace je počítá, pokud jejich oddíl patří do regionu.

## Kategorie (Y = rok začátku sezóny)
J ≤ Y−15, HD16 = Y−14..Y−13, HD14 = Y−12..Y−11, HD12 = Y−10..Y−9, HD10 ≥ Y−8; značka H8/D8 (sloupec VT) pro ≥ Y−6.
Kategorie jsou společné pro chlapce i dívky (barva jména: modrá H, žlutá D); aplikace umí filtr „jen dívky“.

## RŽL Elo — ověřeno ✅ (122 ze 134 hráčů přesně)
- Sloupec „Rapid ELO“ v tabulce = **Rtg hráče v posledním turnaji + K × Σ(skóre − očekávané)**, očekávané skóre z Rtg
  soupeřů uvedených v tom turnaji (výpočet Swiss-Manageru, ratingy během turnaje zamrzlé). Volna a kontumace se nepočítají.
- **K = 25, nový hráč 1000, minimum 900** (2024/25 bylo minimum 800). Rozhodčí přenáší nové Elo jako Rtg do dalšího turnaje.
- Řetězení „vlastní“ hodnoty mezi turnaji místo Rtg sedí hůř (46/134), proto platí Rtg z turnaje. Odchylky: hráči, kterým
  rozhodčí dal jako Rtg LOK rapid (např. 1530 vs. tabulka 1435). Aplikace takové skoky ukazuje v detailu hráče.
- Sloupec „ELO“ (klasické) = LOK Elo z chess.cz. „Přímý postup ELO k 1.10./1.2.“ (červené/zelené jméno) se zadává ručně u hráče.

## Zjištění z dat 2025/26
- Chybná LOK ID v chess-results: 2 neregistrovaní hráči mají v turnaji LOK jiného (registrovaného) hráče → vedeni
  jako neregistrovaní. Ruční tabulka 2026/27 má naopak chybná ID u 2 hráčů; chess-results je má správně.
- Změna jména registrovaného hráče (stejné LOK, chess.cz uvádí nové příjmení). Prohozené jméno a příjmení (vietnamská jména).
- Překlep ve jméně (jedno písmeno) – sloučeno.
- Rozhodnutí o regionu (lze změnit v záložce Oddíly): v regionu okres Benešov + Praha-východ + Zvole (Říčany, Vlašim,
  Sedlčany, ŠŠ Stamat, St.Skalice, Brodce, Sázava, Zvole, Benešov, Chocerady, Mukařov, Mnichovice, Votice, Kamenice);
  mimo: SK OAZA Praha, TJ Bohemians Praha, TJ Sparta Kutná Hora, TJ Kralupy, Šachy Polabí, Adventure School.

## Ověření 2025/26 proti oficiálnímu PDF (`RZL_2025.pdf`, `RZL_2025_kategorie.pdf`)
Porovnáno 179 hráčů × 9 kol (body, umístění, součty, pořadí, kategorie, LOK, rok nar.). Pravidla výpočtu sedí;
všechny zbylé rozdíly jsou chyby/odchylky ručně vedené tabulky (chess-results bereme jako zdroj pravdy).
- **Kategorie HD8** byla v 2025/26 samostatná (nar. ≥ Y−6) → nastavení sezóny `hd8` (v 2024/25 a 2026/27 není).
- **Nenastoupil** (jen kontumace/volna) — tabulka řádek vynechává (1 případ) → Kontrola „no-show“ + vyřazení.
- Hráčka v turnaji uvedená s oddílem mimo region, ale registrovaná v regionálním oddíle → tabulka ji počítá.
- Překlepy v umístění (duplicitní číslo): Pravonín 14, Říčany 4 a 93, Chocerady 9.
- Týnec: tabulka přiřadila výsledky dvou hráčů nesprávným hráčům a jednu partii vedla jako remízu (chess-results: výhra)
  → posun umístění v C. Sedlčany C: jeden hráč 5,5 b. (chess-results 4,5).
- St.Skalice C: tabulka má prohozené výsledky dvou sourozenců.
- Rok nar.: u 2 hráčů se tabulka liší od chess.cz.
