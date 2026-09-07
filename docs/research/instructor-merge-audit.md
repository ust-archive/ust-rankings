# Instructor merge audit

PR #166 adds 59 explicit merge events from immutable Ranking Generation [`f3f375abb0a9bae321018e2deea5bf0891903c81`](https://huggingface.co/datasets/ust-archive/ust-rankings/tree/f3f375abb0a9bae321018e2deea5bf0891903c81). The event UUIDs remain in `data/instructor-identity-corrections.json`.

The source identity and Course-Instructor relations were checked again on 2026-09-07: all 118 event endpoints exist, no pair has conflicting non-null ITSCs, and 58 events have a direct shared Course Offering. The remaining event has the explicit QIU bridge below. Course Offering overlap corroborates the compatible spellings; it is not a general rule for merging co-instructors or people with the same name.

Source file SHA-256 values:

- `instructor-identities.parquet`: `dcbe927f4187707470f5d7f8acedab1f62ef5502f3c48d97fe37f68f0311f25b`.
- `course-instructors.parquet`: `20425524e3dae579675a61a2fc59fad8f7ca8827c8036149f52a924e193a2b5b`.

The survivor UUID keeps the existing SFQ-backed identity. Canonical Instructor Name is selected independently using the documented Schedule, UST Space, then SFQ priority; a merge must not pin the old SFQ display spelling of the survivor.

## Evidence

The table gives one direct shared Course Offering per merge. Names identify the corresponding explicit event, not a new name-based identity rule.

| Retired name | Survivor name before merge | Shared Course Offering |
| --- | --- | --- |
| KAFSHDAR GOHARSHADY, Amir | GOHARSHADY, Amir | COMP 6613B (2030) |
| ZANG, Amy Yunzhi | Amy ZANG | ACCT 3010 (1710) |
| BLANCKAERT, Koen Jacques Ferdinand | BLANCKAERT, Koen | CIVL 3510 (1710) |
| CHAN, Ka Long Roy | CHAN, Roy K L | CORE 1402 (2210) |
| CHANG, Sue Chee Fong | CHANG, Sue | LANG 1002S (1710) |
| CHEN, Wanjing (Kelly) | CHEN, Wanjing | SOSC 1000F (2110) |
| ERDMANN, Cornelia Heidemarie | ERDMANN, Cornelia | HART 1034 (1930) |
| FORSTER, Paul Whitfield | FORSTER, Paul | MGMT 2010 (1710) |
| FU, Li-tsui | FU, Flora Li Tsui | HUMA 3660 (1710) |
| FUNG, Jimmy Chi Hung | FUNG, Chi Hung | MATH 2023 (1710) |
| HUSSIN, Nora Anniesha Binte | HUSSIN, Nora | LANG 1003A (1630) |
| IP, Ho Kin | IP, Honic Ho Kin | ACCT 4610 (1930) |
| JACOBSEN, Arno | JACOBSEN, Hans-arno | COMP 4901A (2430) |
| KWAN HUANG, Enrique | KWAN, ENRIQUE | CHEM 1050 (1730) |
| KWAN, Yuen Tung Gloria | KWAN, Gloria | LABU 2060 (1830) |
| LAI, Pui Yee | LAI, Beatrice Pui-yee | SOSC 1980 (1630) |
| LAI, David | LAI, David T W | ACCT 4610 (2330) |
| LAI, Tai Wai David | LAI, David T W | ACCT 4510 (1710) |
| LAI, Ernest | LAI, Ernest K | ECON 2113 (2310) |
| LAW, Kwok Yung Anthony | LAW, Anthony | MECH 4350 (2030) |
| LEE, Ricky Shi-wei | LEE, Ricky | MECH 2020 (1710) |
| LEE, Chun Man Rolian | LEE, Rolian | LABU 2060 (2410) |
| LEUNG, Chi Sun Benjamin | LEUNG, Benjamin C S | LANG 1002S (1710) |
| LEUNG, Kar Wah | LEUNG, Melody Kar Wah | LIFS 2080 (1630) |
| LI, Kwok Hung Gerry | LI, Gerry K H | ACCT 2010 (1710) |
| LO, Irene Man Chi | LO, Man Chi | CIVL 1100 (1630) |
| LUI, Lok Yi Joyce | LUI, Lok Yi | LANG 2010 (2410) |
| MOSS, Cynthia Faith | MOSS, Cynthia | LIFS 4000A (1810) |
| NEARY, Philip Ruane | NEARY, Philip | ECON 2113 (1810) |
| NG, Chi Yun Jeanne | NG, Jeanne | MGMT 3160 (2130) |
| NG, Choi Ping Martha | NG, Martha | LANG 1003S (1630) |
| NG, Lung Fai Moses | NG, Moses | MECH 1905 (1630) |
| NI, Sophie Xiaoyan | NI, Xiaoyan | FINA 3203 (1630) |
| ACHUTAVARRIER PRASAD, Vinod | PRASAD, Vinod | ELEC 1100 (2110) |
| Miss QIU, Luying | QIU, Iris | Via QIU Luying Iris: ISOM 3400 (2240), then ISOM 2010 (2410) |
| QIU Luying Iris | QIU, Iris | ISOM 2010 (2410) |
| RICKARD, Jonathan Theodore Robert | RICKARD, Jonathan | LANG 1409 (2430) |
| SEK, Man Chi Ivy | SEK, Ivy | LANG 1003A (1630) |
| SHIU, Wai Yee Winnie | SHIU, Wai Yee | CIVL 4100U (2410) |
| SIU, Chi Ming Anthony | SIU Anthony | LANG 1002S (1710) |
| SIU, Wai Sze Grace | SIU, Grace | SCIE 1100 (2010) |
| SO, Mike Ka Pui | SO, Ka Pui | ISOM 3540 (1810) |
| STAMPER, Suzan | STAMPER, Suzan Elizabeth | CORE 1402 (2210) |
| SZYDLOWSKI, Martin Adam | SZYDLOWSKI, Martin | ECON 3133 (2410) |
| TAM, Kevin Kim-Pong | TAM, Kim-Pong | SOSC 1960 (1730) |
| TANG, Cheong Wai | TANG, Cheong Wai Acty | HART 1028 (1910) |
| THALLEMER, Axel Michael | THALLEMER, Axel | ISDN 2000 (2010) |
| TSANG, Shuk Ching Elza | TSANG, Elza | LABU 2040 (1710) |
| TYE, Henry Sze-hoi | TYE, Henry | PHYS 1114 (1730) |
| WEI, Victor Junqiu | WEI, Junqiu | COMP 4221 (2330) |
| WEST, Leonard Kip | WEST, Leonard | LANG 1002S (1710) |
| WONG, Kai Hung | WONG, Jerry Kai Hung | LANG 3012 (1730) |
| WONG, Lok Yee Lorraine | WONG, Lorraine L Y | LANG 1113C (2110) |
| WONG, T.Y. William | WONG, William | HUMA 1720 (2010) |
| YIK, Ping Chui | YIK, Ellen Ping Chui | LANG 1002S (1910) |
| YUEN, Chaya | YUEN, Tsz Lo Chaya | LIFS 1901 (2410) |
| ZHANG, Yi Qin Jane | ZHANG, Jane Y Q | SOSC 1000A (1810) |
| ZHANG, Lok Cheung Lawrence | ZHANG, Lawrence LC | HUMA 1000 (1630) |
| ZHOU, Zoey Yiyuan | ZHOU, Yiyuan | SUST 1101 (2430) |

For the bridge, `Miss QIU, Luying` and `QIU Luying Iris` share ISOM 3400 in Term 2240; `QIU Luying Iris` and `QIU, Iris` share ISOM 2010 in Term 2410. The full spelling connects both given names. This is a reviewed correction, not transitive fuzzy matching.

## Verification

- End-to-end fixture regression reproduces the SFQ-name preference defect and verifies the Schedule spelling and survivor UUID across two pipeline runs.
- Full pipeline rebuilt the pinned research sources against the cited identity generation: 199,494 observations, 2,846 Instructors, and 176 unique merge events.
- Data type checking and 33 data tests passed.
