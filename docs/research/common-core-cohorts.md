# HKUST Common Core cohort schemes

## Confirmed schedule taxonomy

The 2026–27 Fall HKUST Class Schedule exposes four cohort labels and scheme codes. Category IDs below are the numeric final path segment and names are reproduced from the schedule; abbreviations are not expanded beyond the primary source. [HKUST schedule][wcq]

| Cohort label | Scheme | Category IDs and names |
|---|---|---|
| Students admitted before 2022 | `4Y` | `09` SSC-H; `10` SSC-SA; `11` SSC-S&T; `12` H; `13` SA; `14` S&T; `15` QR; `16` Arts; `17` E-Comm; `18` C-Comm; `19` HLTH |
| Students admitted in 2022-2024 | `CC22` | `20` CTDL; `21` HMW; `22` E-Comm; `23` C-Comm; `24` A; `25` H; `26` S; `27` T; `28` SA; `29` UxOP-UROP; `30` UxOP-UTOP; `31` UxOP-UPOP; `32` UxOP-UCOP |
| Students admitted in 2025 | `CC25` | `33` CTDL; `34` HMW; `35` E-Comm; `36` C-Comm; `37` A; `38` H; `39` S; `40` T; `41` SA; `42` SUS; `43` UxOP-UROP; `44` UxOP-UTOP; `45` UxOP-UPOP; `46` UxOP-UCOP |
| Students admitted from 2026 | `CC26` | `47` HAIC; `48` HMW; `49` E-Comm; `50` C-Comm; `51` A; `52` H; `53` S; `54` T; `55` SA; `56` SUS; `57` UxOP-UROP; `58` UxOP-UTOP; `59` UxOP-UPOP; `60` UxOP-UCOP |

The notable cohort changes are: `CC22` adds the 30-credit taxonomy but has no SUS category; `CC25` adds SUS (`42`); and `CC26` replaces CTDL with HAIC while assigning a new ID range to every category. [HKUST schedule][wcq]

## Repository state and limitations

- The checked-in 3,794-course catalog contains attributes for `4Y`, `CC22`, and `CC25`, but none for `CC26`. Its observed ID sets match the schedule except that no catalog entry carries `4Y` ID `17` (E-Comm). This is an inventory fact, not evidence that HKUST removed the official category. [Course catalog][catalog]
- Rankings exposes only one fixed 14-category model, with human-readable labels mapped specifically to `CC25` IDs `33`–`46`; it has no scheme/cohort field. [Category type and mapping][mapping]
- Course classification explicitly accepts only attributes whose scheme is `CC25`, so `4Y` and `CC22` metadata already present in the catalog is ignored. `CC26` is unsupported both by the mapping and by the current catalog snapshot. [Catalog lookup][lookup]
- Multiple selected categories are ORed. The Common Core filter applies only to course rankings, not instructor rankings. [Query validation][validation] [Filter behavior][filter]

**Settings implication:** a cohort selector cannot be represented faithfully by the current server contract. Supporting all four official choices requires scheme-aware category mappings; `CC26` additionally requires refreshed catalog data and a decision on the user-facing meaning of official abbreviation `HAIC`.

## Sources

- [HKUST Class Schedule & Quota, 2026–27 Fall][wcq] — official cohort labels, scheme paths, category IDs, and displayed category names.
- [Repository course catalog][catalog] — checked-in course-attribute schemes, values, and descriptions.
- [Rankings server][server] — current Common Core types, mappings, catalog classification, validation, and filter behavior.

[wcq]: https://w5.ab.ust.hk/wcq/cgi-bin/2610/
[catalog]: ../../data/data-course-catalog.json
[server]: ../../lib/rankings/server.ts
[mapping]: ../../lib/rankings/server.ts#L41-L112
[lookup]: ../../lib/rankings/server.ts#L2098-L2106
[validation]: ../../lib/rankings/server.ts#L1943-L1952
[filter]: ../../lib/rankings/server.ts#L2192-L2197
