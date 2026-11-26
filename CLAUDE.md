# RŽL – evidence výsledků

Web aplikace pro evidenci výsledků Regionální žákovské ligy (region SE Benešov): načítání turnajů z chess-results.com,
párování hráčů, kontrola dat, ruční opravy, pořadí (celkové + kategorie) a vlastní RŽL Elo.
Pravidla a ověření proti oficiálním PDF: `doc/pravidla.md`. Zdrojová PDF: `doc/source/`.

## Stack (stejná architektura jako ../vedouci-souteze)
- Jeden Cloudflare Worker (`worker/index.ts`, Hono) pod `/api/v1/*` + static assets SPA (`dist/`, build z `web/`).
- D1 (`DB`, `rzl-db`), schéma jen přes `migrations/NNNN_*.sql`.
- Frontend React 18 + Vite 6 + React Router 6 + TanStack Query 5 + **Ant Design 6** (cs_CZ).
- `shared/` = čistá TS logika (parser chess-results, pravidla RŽL, typy API), pokrytá vitestem
  (`shared/__tests__/rzl.test.ts` přepočítává 2026/27 kola 1–3 z uložených HTML a porovnává s oficiální tabulkou).

## Příkazy
- `npm run dev` — wrangler dev (:8788) + vite (:5174, proxy /api). Poprvé `npm run db:migrate:local`.
- `npm run check`, `npm test`, `npm run build`.
- wrangler spouštěj bez proxy proměnných (`env -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY`).
- **Osobní data hráčů (žáci) nejsou v gitu** (repo je veřejné): `data/seed-*.sql`, `doc/source/` (oficiální PDF),
  `doc/private/` (zjištění se jmény), `shared/__tests__/fixtures/` (stažené stránky chess-results) jsou jen lokálně;
  testy, které je potřebují, se bez nich přeskočí. Do kódu, testů ani dokumentace nepiš skutečná jména hráčů.
- `npm run db:seed:local` — nahraje zpracovanou sezónu 2025/26 (`data/seed-2025-26.sql`) do prázdné lokální DB
  (stará data bez instancí se při prvním načtení sezóny převedou, `backfillInstances`).
- `npm run db:fresh:local` — **smaže lokální DB**, nahraje seed a odstraní z něj vše odvozené (`data/reset-identity.sql`):
  zůstanou jen sezóna, kola a stažené stránky turnajů → přehrání sezóny od nuly „Načíst kolo“ bez stahování.

## Konvence
- Kód a komentáře anglicky, UI a chybové hlášky API česky.
- Zatím jen lokální verze bez přihlášení. Před nasazením převzít auth z ../vedouci-souteze (Google OAuth + JWT cookie),
  vytvořit D1 (`wrangler d1 create rzl-db`) a doplnit `database_id` + `ENVIRONMENT` ve `wrangler.jsonc`.

## Gotchas
- chess-results: `www.` má rozbitý certifikát → vždy `https://chess-results.com/...` (přesměruje na S1–S3 node).
  Stránky s `&turdet=YES` fungují GETem, ale **detail turnaje** (seznam navázaných turnajů) u turnajů starších 2 týdnů
  vyžaduje ASP.NET postback tlačítka `cb_alleDetails` (`worker/lib/chessresults.ts`).
- Hlavní tabulka stránky je `<table class="CRs1">`; stránka má vnořené layoutové tabulky. Remíza je `&frac12;`,
  zahraniční jména mají Latin-1 entity (`&ouml;`) — `decodeHtml` v `shared/chessresults.ts`.
- Rate-limit: chess-results ≥ 1 s mezi požadavky, chess.cz ≥ 350 ms (burst = blokace IP na hodiny). Vše přes `worker/lib/gate.ts`.
  Dlouhé dávky (stažení všech turnajů, doplnění hráčů) řídí prohlížeč po jednom požadavku (`BatchRunner`).
- **Identifikace hráčů = instance** (`shared/identity.ts`, `worker/lib/instances.ts`, záložka Párování). Hráč (root,
  `players`, RŽL ID) vystupuje v turnajích pod instancemi = unikátní (normalizované jméno, LOK z turnaje, normalizovaný
  oddíl) — v praxi kopie záznamu ze Swiss Manageru. Řádek → instance → hráč; přiřazení se rozhoduje a ověřuje jednou
  za instanci. Stav instance: `open` (k rozhodnutí, řádky se nepočítají) / `auto` (přiřazeno automaticky, ke kontrole) /
  `ok` (potvrzeno). Nová instance: LOK hráče v evidenci + podobné jméno → `auto`; LOK z jiné instance hráče → `auto`;
  jinak podobný hráč → `open` s kandidáty; nikdo podobný → nový hráč `auto`. Řádek bez LOK se nikdy nepřiřadí jen podle jména.
- `entries.match = 'manual'` = výjimka jen pro jeden řádek (řádek nesleduje svou instanci). Jiné hodnoty už se nepoužívají.
- **LOK s jiným jménem na chess.cz** (`shared/lokcheck.ts`, `decideLok`, tabulka `lok_verdicts`). Hrál vždy ten, kdo je
  jménem v turnaji (podle jména se losuje a usazuje); rozhoduje se jen, komu patří LOK – jednou za LOK, verdikt:
  `cz` = platí chess.cz (změna jména, výjimečně hrála ta osoba; jméno/pohlaví/rok z chess.cz), `cz-error` = LOK patří hráči
  z turnaje, chess.cz má chybné jméno (LOK zůstane kvůli Elu; jméno a pohlaví z chess.cz se nikdy nepřebírají, info v Kontrole
  „nahlásit“), `bad-lok` = chybné LOK v turnaji (hráč bez LOK). Nepotvrzený hráč (vše `auto`) se po načtení z chess.cz vrátí
  do `open` (`reopenOnLokConflict`) a zůstane jen jako držitel LOK. Párování ukáže záznam chess.cz pod turnajem a stopy
  (duplicitní jméno v oddíle, abecední dávka registrací – sousední LOK, rok z karty, pohlaví podle jména, křestní jméno);
  „Doplnit údaje hráčů“ k tomu načte detail LOK a seznam oddílu. Hráč bez LOK převezme LOK z instance jen při shodě
  jména na chess.cz nebo verdiktu `cz` / `cz-error`.
- Instance si pamatuje LOK tak, jak ho napsal turnaj (může být cizí). Ruční změna LOK hráče jen opraví evidenci; další
  turnaje s chybným LOK najdou hráče přes jeho instanci. Při přiřazení instance s LOK hráči bez LOK hráč LOK převezme.
- Přehrání 2025/26 (`shared/__tests__/identity.test.ts`) ověřuje, že automatika nikdy nepřiřadí proti odladěným datům
  a výsledek je stejných 196 hráčů (754 řádků → 209 instancí, 14 k rozhodnutí).
- Pořadatel občas nechá u jména „do A“ (postup) — parser ho odstraní (`splitMark`), uloží do `entries.cr_mark`.
- chess.cz: údaje hráče (pohlaví, rok, jméno, oddíl) vždy z detailu člena `/members/{LOK}/cze` po jednom („Doplnit údaje
  hráčů“). „Aktualizovat Ela“ (`/seasons/:id/refresh-elo`) jde po oddílech `/clubs/{kód}/members` (kód oddílu z detailu,
  `chesscz.clubId`; seznam oddílu nemá pohlaví) a jen hráče nenalezené ve svém oddíle čte po jednom. Ukládá Elo ČR std/rapid
  a FIDE std/rapid/blesk.
- chess.cz API vrací pohlaví `M` / `Ž` → normalizuje se na `M` / `F` (`normGender` v `worker/lib/chesscz.ts`).
- RŽL ID hráče = `players.id` (AUTOINCREMENT, nikdy se nerecykluje), zobrazované jako `R0079` (`rzlId` v `shared/text.ts`);
  instance `I0412` (`instId`). Sloučení = přesun instancí, zůstává ID cílového hráče. Hráč bez instancí a řádků se maže (`dropIfOrphan`).
- Jeden hráč hraje v kole jen jeden turnaj: kandidát, který hraje ve stejném kole jako instance, je „jiný hráč“ (jistota 0, bez
  „Je to on(a)“), a dvojice hráčů ze stejného kola se v Kontrole nehlásí jako duplicita (`roundsByPlayer`, `sharedRound`).
  Když tím vypadnou všichni kandidáti otevřené instance, je to nový hráč `auto` (ke kontrole) – `resolveRuledOut` po každém
  importu turnaje a na začátku „Doplnit údaje hráčů“.
- Duplicity (`seasonIssues`): hráči sezóny × všichni hráči v DB, pokud nemají oba LOK; podobnost jmen `similarNames`
  (shoda / prohozené pořadí / překlep / jméno navíc); známý rozdílný rok narození pár vyřadí. Volba „Nový hráč“ u otevřené
  instance upozornění vůči jejím kandidátům rovnou odklikne.
- Rok narození neregistrovaných: z karty hráče na chess-results (art=9), čte se jednou za instanci („Doplnit údaje hráčů“).
- Kontrola: chyby (červené) a odhadnuté pohlaví nejde „odkliknout“ (`isAckable`), musí se vyřešit; odhady pohlaví mají
  vlastní kartu s hromadným potvrzením (`POST /seasons/:id/genders`). Nenačtené turnaje ani „ke kontrole“ z Párování
  v Kontrole nejsou (mají vlastní záložky); nerozhodnuté instance jsou jedna souhrnná chyba `inst-open`.
- Historie rozhodnutí (Kontrola → Historie): každé rozhodnutí / oprava v API zapíše řádek do `decision_log` (`logDecision`
  v `worker/lib/log.ts`) – párování, LOK, pohlaví, řádky, „V pořádku“, hráč, oddíl, sloučení. Nová akce = přidat zápis.
- Příslušnost k regionu: hráč (override) → oddíl/místo → nerozhodnuto (= nepočítá se + chyba v Kontrole).
