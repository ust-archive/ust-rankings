# Research: Establish privacy, anonymity, and disclosure obligations

## Summary

Wayfinder may authenticate authors while showing only a pseudonym (or no author identifier) publicly, but it must not call that arrangement “anonymous” while it retains an account-to-post link: that link remains personal data under Hong Kong’s Personal Data (Privacy) Ordinance (Cap. 486) (PDPO). A collection-time PICS should plainly disclose the identity/account data collected, that supply is required to contribute, the purposes of authentication, publication, moderation and abuse investigation, concrete transferee classes, and access/correction contact details; a continuously available privacy policy should additionally explain data kinds, practices, retention, security, deletion, processors/cloud hosting, and disclosure handling.

This is research, not legal advice. The operator and hosting facts, exact retention periods, compelled-disclosure workflow, and treatment of allegations or files containing third-party data should be reviewed by qualified Hong Kong counsel before launch.

## Findings

1. **Internal traceability is pseudonymity, not anonymity.** Under PDPO section 2(1), information is personal data where it relates directly or indirectly to a living person, that person’s identity is practicably ascertainable directly or indirectly, and the data is in processable form. PCPD applies a “totality” approach across information controlled by the data user. Thus an internal account identifier, authentication-provider subject, email, IP/log data, contribution, and the mapping among them remain personal data even if the public sees only “Anonymous” or a pseudonym. Genuine anonymisation requires that neither the operator nor anyone else can re-establish identity; removing obvious identifiers alone may be insufficient. [PDPO overview](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html) · [PCPD anonymisation/erasure guidance](https://www.pcpd.org.hk/english/publications/files/erasure_e.pdf) · [PCPD legal perspective, §§2.18–2.21](https://www.pcpd.org.hk/english/publications/files/Perspective_2nd.pdf)

2. **There is no identified PDPO requirement to publish an author’s identity, nor a requirement to promise public anonymity.** Public concealment of the account identity is a product/policy choice. However, DPP1 requires lawful, fair, necessary, adequate and non-excessive collection. A misleading promise of “anonymous” participation would be difficult to reconcile with fair collection where the service deliberately preserves a re-identifiable author mapping. The prudent description is: “Your identity is not displayed publicly, but authorised moderators can link your contribution to your account for the purposes described below.” [Schedule 1, DPP1](https://www.elegislation.gov.hk/hk/cap486!en/sch1?_lang=en) · [PCPD compliance guide on fair collection](https://www.pcpd.org.hk/misc/booklets/e-lawbook/html/files/assets/basic-html/page-46.html)

3. **A collection-time PICS has mandatory content.** When Wayfinder collects personal data directly from an author, DPP1(3) requires all reasonably practicable steps to inform the author, on or before collection, whether supply is voluntary or obligatory and, if obligatory, the consequence of non-supply; explicitly state the purposes of use and reasonably definite classes of transferees; and, on or before first use, state access/correction rights plus the name or job title and address of the person handling requests. PCPD recommends a written, prominent, purpose-specific PICS and rejects vague transferee classes such as “any person” or generic “partners.” [PCPD PICS/PPS guidance, pp. 2–5](https://www.pcpd.org.hk/english/resources_centre/publications/files/GN_picspps_e.pdf) · [Schedule 1, DPP1(3)](https://www.elegislation.gov.hk/hk/cap486!en/sch1?_lang=en)

4. **A PICS and a privacy policy/PPS serve different roles.** The PICS must be presented at each direct collection point (account connection, submission form, upload form, and any later collection of a new data kind). DPP5 requires the operator to make generally available its personal-data policies and practices, kinds of personal data held, and main purposes of use; PCPD says this PPS should remain available at all times and may cover retention, security, breach handling, cookies, processors, and access/correction handling. A single layered notice can serve both roles only if the mandatory PICS information is conspicuous at or before collection rather than buried behind a generic footer link. [PCPD PICS/PPS guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/GN_picspps_e.pdf) · [Schedule 1, DPP5](https://www.elegislation.gov.hk/hk/cap486!en/sch1?_lang=en)

5. **Authentication, internal identity retention, and moderation must be stated as purposes, not hidden implementation details.** DPP3 limits later “use”—which includes disclosure and transfer—to the original collection purpose or a directly related purpose, unless the data subject gives express, voluntary consent or a Part 8 exemption applies. The PICS should therefore name: (a) authenticating eligibility/account ownership; (b) receiving, reviewing and publishing contributions under a public pseudonym/no public identity; (c) communicating about a submission; (d) detecting, investigating and acting on spam, fraud, threats, doxxing, manipulation and rule violations; (e) maintaining proportionate security/audit records; and (f) establishing, exercising or defending Hong Kong legal rights and responding to valid legal process. [PDPO overview, DPP3](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html) · [Schedule 1, DPP3](https://www.elegislation.gov.hk/hk/cap486!en/sch1?_lang=en)

6. **Moderator access is not public disclosure, but it must be tightly controlled.** DPP4 requires all practicable steps against unauthorised or accidental access, processing, erasure, loss or use, considering the data, likely harm, storage location, system controls, staff integrity/competence, and secure transmission. Recommended controls are role-based need-to-know access to identity mappings, MFA for moderators, encryption in transit and at rest, separate storage or logical segregation of public content and identity mappings, audit trails, access review, and a documented abuse-investigation workflow. These controls support—rather than replace—the legal DPP4 obligation. [PCPD ICT security guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/guidance_datasecurity_e.pdf) · [PCPD Data Security portal](https://www.pcpd.org.hk/english/data_security/index.html)

7. **Do not promise absolute confidentiality or “we never disclose.”** DPP3 ordinarily restricts identity disclosure to an original/directly related purpose. Section 60B exempts a use from DPP3 where it is required or authorised by Hong Kong enactment, rule of law or court order, required in connection with Hong Kong legal proceedings, or required to establish, exercise or defend Hong Kong legal rights; PCPD stresses that the exemption does not itself compel disclosure. Section 58 may exempt a disclosure for crime/unlawful-conduct purposes only where its statutory conditions, including likely prejudice from non-use, are met. PCPD recommends that a data user assess a law-enforcement request itself and ask about purpose, necessity/relevance, lack of consent, alternative sources, and prejudice. A prudent notice says identity “may” be disclosed to courts, regulators, law-enforcement bodies, or parties/advisers involved in Hong Kong legal rights **where required or authorised by law, valid legal process, or an applicable PDPO exemption**, and that requests are reviewed; it should not imply automatic voluntary disclosure on any informal request. [PCPD guide, section 60B](https://www.pcpd.org.hk/misc/booklets/e-lawbook/html/files/assets/basic-html/page-183.html) · [PCPD guide, section 58 request assessment](https://www.pcpd.org.hk/misc/booklets/e-lawbook/html/files/assets/basic-html/page-178.html)

8. **Doxxing risk warrants fast moderation, but “abuse” is not a blank cheque to reveal an author.** PDPO section 64 criminalises specified non-consensual disclosures made with intent or recklessness as to specified harm, with a more serious tier where harm results. PCPD can serve cessation notices on platform/hosting operators. The policy should prohibit users from uploading or publishing personal data to harass, threaten or expose others; provide a report/takedown channel; quarantine suspect content; preserve only the evidence needed for a documented investigation; and escalate disclosure decisions rather than letting moderators unmask authors publicly. [PCPD doxxing implementation guideline](https://www.pcpd.org.hk/english/doxxing/files/GN_PDPAO_e.pdf) · [PCPD Doxxing Offences](https://www.pcpd.org.hk/english/doxxing/)

9. **Retention must be purpose-based; account deletion is not an unconditional, immediate erasure right under the PDPO.** DPP2(2) bars keeping personal data longer than necessary for its purpose. Section 26 requires all practicable steps to erase data no longer required, unless erasure is prohibited by law or is not in the public interest. DPP6 and Part 5 provide access/correction rights (normally a 40-day response), not a GDPR-style general right to deletion. The policy should specify separate periods or objective criteria for account/authentication data, contribution-to-author mappings, moderation evidence, security logs, rejected uploads, published submissions, and backups; explain what happens on account closure; and avoid saying everything is instantly or irrevocably deleted if backups or justified abuse/legal records remain. All copies and backups must be considered in erasure procedures; inaccessible backup data should not be restored to ordinary use after scheduled deletion. [PDPO overview, DPP2/DPP6/section 26](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html) · [PCPD erasure guidance](https://www.pcpd.org.hk/english/publications/files/erasure_e.pdf) · [PCPD DAR guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/DAR_e.pdf)

10. **Processors and offshore cloud storage remain the operator’s responsibility.** DPP2(3) and DPP4(2) require contractual or other means to make processors comply with retention and security protections. PCPD says cloud contracts should address purpose limits, access/correction support, deletion/return, subprocessors, breach notification and controls; the notice should identify definite transferee classes (for example, “authentication provider,” “cloud hosting and object-storage providers,” “email provider,” and “security/abuse service providers”) rather than naming every vendor unless operationally useful. Section 33’s cross-border restriction has not commenced, but PCPD recommends disclosure of offshore processing and comparable protection; actual hosting locations and vendor terms must be verified. [PCPD cloud guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/IL_cloud_e.pdf) · [PCPD PICS/PPS guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/GN_picspps_e.pdf)

11. **Uploaded files require both privacy and application-security treatment.** Files may contain the uploader’s identifiers, filenames/metadata, and personal data about instructors, students, or other third parties. Collect only necessary file types/content; warn uploaders not to include unnecessary personal data; keep uploads non-public pending review; redact unnecessary identifiers/metadata before publication; and delete rejected originals on a short schedule unless temporarily needed for abuse/security handling. An uploader warranty that they have authority to submit material is prudent but does not displace Wayfinder’s own DPP duties. Under DPP4, controls should match harm; OWASP recommends authorised uploads, extension allowlists, independent MIME/signature validation, generated filenames, size limits, storage on a separate host or outside the webroot, and malware/sandbox or content-disarm scanning where applicable. [PCPD ICT security guidance](https://www.pcpd.org.hk/english/resources_centre/publications/files/guidance_datasecurity_e.pdf) · [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

12. **Public reviews may themselves be personal data about instructors and identifiable students.** Public-source or user-supplied information is not unrestricted merely because it is already online. DPP1 lawful/fair collection, DPP2 accuracy, DPP3 purpose limitation, doxxing rules, defamation, confidentiality, intellectual-property rights, and platform liability can overlap. The operator should prohibit unsupported allegations and unnecessary third-party identifiers, offer correction/reporting paths, and obtain counsel’s view on moderation standards and publication risks. [PCPD public-domain case note](https://www.pcpd.org.hk/english/enforcement/case_notes/casenotes_2.php?content_nature=&content_type=33&id=2025E03&msg_id2=613) · [PCPD doxxing guideline](https://www.pcpd.org.hk/english/doxxing/files/GN_PDPAO_e.pdf)

## Obligation / recommendation / legal-review matrix

| Topic | Legal baseline | Recommended Wayfinder policy | Requires legal advice |
|---|---|---|---|
| Authenticated authors | DPP1 necessity, proportionality, lawful/fair collection; DPP1(3) notice | Collect the minimum authentication claim; do not collect HKID; explain why login is required | Whether eligibility verification needs any specific institutional attribute |
| Public anonymity | No located mandate to publish or conceal identity; a re-identifiable mapping stays personal data | Say “not displayed publicly,” not “anonymous”; never expose identity through URLs, filenames, APIs or moderation messages | Any exceptional public-interest unmasking policy should be avoided unless counsel approves |
| Internal identity retention | DPP2/section 26 necessity and erasure; DPP4 security | Segregate mappings; need-to-know moderators; stated schedule/criteria and access logging | Exact period justified by abuse patterns, limitation periods and likely claims |
| Abuse moderation | DPP3 original/directly related purpose; DPP4 | Name moderation/abuse/security purposes in PICS; documented escalation and takedown process | Whether a proposed disclosure fits sections 58/60B or another exemption |
| Identity disclosure | DPP3 unless consent/exemption; sections 58/60B are conditional; section 60B does not compel by itself | Review/verify requests; disclose the minimum; log decision; notify user unless prohibited or harmful | Subpoenas/orders, police/regulator requests, overseas requests, threatened litigation |
| Retention/deletion | DPP2(2), DPP2(3), section 26; DPP6 access/correction | Record-class schedule; deletion workflow including processors/backups; explain account closure precisely | Public-interest/non-erasure exceptions and litigation holds |
| Uploaded files | DPP1–4 apply to personal data in content/metadata; processor duties apply | Private quarantine, metadata stripping/redaction, malware validation, rejected-file deletion, uploader rules | Third-party data, confidential/copyrighted teaching materials, allegations, minors |

## Minimum short-form PICS content (draft, not production legal text)

> **Privacy notice for contributors.** To submit a contribution, you must sign in. If you do not provide the required account/authentication information, you cannot submit. We collect your authentication identifier, account contact information made available by the sign-in service, submission and uploaded-file data (including filenames and metadata), and security/moderation logs. We use them to verify and operate your account; receive, review and publish contributions without displaying your account identity publicly; contact you; protect the service; prevent, investigate and respond to abuse or rule violations; and establish, exercise or defend legal rights and respond to valid legal process. Authorised moderators can link a contribution to your account. We may transfer relevant data to our authentication, cloud hosting/storage, communications, and security/abuse service providers, and where required or authorised under applicable law or valid legal process, to courts, regulators, law-enforcement bodies, and legal advisers or parties involved in legal claims. [State offshore processing if applicable.] You may request access to or correction of your personal data by contacting **[job title]**, **[postal address]**, **[email]**. See our Privacy Policy for retention, deletion, security and complaint details.

Before use, replace every bracket, verify each collected field/provider/transferee and hosting jurisdiction, add an upload-specific warning against unnecessary third-party data, and have Hong Kong counsel approve the legal-process and claim language.

## Recommended retention design (policy choice, not a statutory schedule)

- **Rejected/unsubmitted upload originals:** delete promptly after review/expiry of a short submission window, except a narrowly restricted copy temporarily retained for a documented security or abuse case.
- **Authentication/account data:** while the account is active, then a short closure period needed to complete deletion, subject to documented legal/abuse holds.
- **Contribution-to-author mapping:** choose and publish a defensible period tied to correction, moderation and legal-claim needs; do not default to indefinite retention merely because storage is cheap.
- **Moderation/security records:** event-based period proportionate to severity; retain the minimum evidence and restrict access.
- **Published contribution:** distinguish public content retention from identity mapping retention. Deleting the account need not automatically require deletion of non-identifying public content if the notice and contribution terms explain this and the remaining content is not personal data; assess re-identification in context.
- **Backups:** rolling expiry; deleted data must not return to active use if a backup is restored.

No numeric period can be responsibly selected from the legal sources alone without the actual data model, moderation process, hosting/backup design and counsel’s assessment.

## Sources

### Kept

- [Cap. 486, Schedule 1 — Data Protection Principles](https://www.elegislation.gov.hk/hk/cap486!en/sch1?_lang=en) — primary legislation for DPP1–DPP6.
- [PCPD, The Personal Data (Privacy) Ordinance at a Glance](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html) — regulator summary of the statutory scheme, section 26, access/correction, security and exemptions.
- [PCPD, Guidance on Preparing PICS and PPS](https://www.pcpd.org.hk/english/resources_centre/publications/files/GN_picspps_e.pdf) — authoritative collection-notice content, timing, transferee specificity and PPS guidance.
- [PCPD, Guidance on Personal Data Erasure and Anonymisation](https://www.pcpd.org.hk/english/publications/files/erasure_e.pdf) — authoritative distinction between pseudonymous/personal and genuinely anonymous data, plus deletion/backups.
- [PCPD, Guidance on Cloud Computing](https://www.pcpd.org.hk/english/resources_centre/publications/files/IL_cloud_e.pdf) — processor, cloud, cross-border, deletion and security expectations.
- [PCPD, Data Security Measures for ICT](https://www.pcpd.org.hk/english/resources_centre/publications/files/guidance_datasecurity_e.pdf) — regulator security and minimisation guidance.
- [PCPD, Doxxing Implementation Guideline](https://www.pcpd.org.hk/english/doxxing/files/GN_PDPAO_e.pdf) — authoritative section 64 and cessation-notice guidance.
- [PCPD, Proper Handling of Data Access Requests](https://www.pcpd.org.hk/english/resources_centre/publications/files/DAR_e.pdf) — authoritative access/correction mechanics and 40-day period.
- [PCPD Practical Guide, sections 58 and 60B](https://www.pcpd.org.hk/misc/booklets/e-lawbook/html/files/assets/basic-html/page-178.html) — regulator guidance on law-enforcement request assessment and legal-proceeding exemptions.
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) — authoritative security-community controls specific to untrusted uploaded files.

### Dropped

- Generic law-firm and privacy-blog summaries — excluded because the ticket requires primary Hong Kong legal/regulatory sources.
- Search-result commentary and unrelated “anonymous review” platform policies — excluded because they neither establish Hong Kong obligations nor provide authoritative security guidance.
- Historic commentary on pre-2021 section 64 — excluded where superseded by the current doxxing regime.

## Gaps / residual uncertainty

- The repository’s actual identity provider, fields/claims, database mapping, cookies/analytics, logs, file types, storage vendors, subprocessors, regions, backup lifecycle and moderator roles were not established from the accessible materials.
- The legal identity/location of the data user/operator is unknown; territorial scope and contracting responsibility need confirmation.
- Exact retention periods require operational facts plus Hong Kong legal advice; the PDPO supplies a necessity standard, not a universal number.
- Counsel should review defamation, confidentiality, copyright, minors, university-policy/contract issues, litigation holds, overseas legal requests, and whether particular disclosure scenarios meet sections 58 or 60B.
- A reviewer should test all public/API/file-download paths for identifier, filename, metadata and access-control leakage before any anonymity statement is made.

## Requested ticket-delivery status

**One-line gist:** Authenticate contributors but promise only public pseudonymity—not true anonymity—while giving a collection-time PICS that expressly covers internal linkage, moderation, definite transferees, conditional legal disclosure, purpose-based deletion, and private/secure upload handling.

- **Issue:** https://github.com/ust-archive/ust-rankings/issues/16
- **Requested branch:** `research/review-privacy-obligations`
- **Commit:** not created (this research worker had no shell/`gh`/git tool)
- **Requested repository report path:** `docs/research/review-privacy-obligations.md`
- **Actual research artifact:** `C:\Users\Flandia\.pi\agent\sessions\--D--Projects-@ust-archive-ust-rankings--\subagent-artifacts\outputs\8d364191-90a9-4887-a941-32c8d255013d\privacy.md`
- **Residual uncertainty:** operator/vendor facts, exact retention periods, and fact-specific disclosure/publication risks require qualified Hong Kong legal review.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "not-satisfied",
      "evidence": "The focused primary-source research and report were completed without widening substantive scope, but this worker had no shell or gh/git tool and therefore could not claim/close issue #16, create the requested branch/repository file, commit, push, or comment."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "The artifact records cited legal findings, a requirements matrix, draft PICS content, kept/dropped sources, gaps, requested delivery identifiers, and the exact limitation preventing repository lifecycle evidence."
    }
  ],
  "changedFiles": [
    "C:\\Users\\Flandia\\.pi\\agent\\sessions\\--D--Projects-@ust-archive-ust-rankings--\\subagent-artifacts\\outputs\\8d364191-90a9-4887-a941-32c8d255013d\\privacy.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "gh issue edit 16 --add-assignee @me",
      "result": "not-run",
      "summary": "No command-execution tool was available to this research worker."
    },
    {
      "command": "git/gh branch, status, commit, push, issue comment and close workflow",
      "result": "not-run",
      "summary": "No command-execution tool was available to this research worker."
    }
  ],
  "validationOutput": [
    "Research restricted to Hong Kong e-Legislation/PCPD primary regulatory materials and OWASP for file-upload security.",
    "Report explicitly separates legal baselines, recommended policy, and issues requiring legal advice.",
    "No Wayfinder map or repository file was edited by this worker."
  ],
  "residualRisks": [
    "Repository delivery and GitHub issue lifecycle remain for the parent session with shell access.",
    "No git status or staged-file check could be executed.",
    "Operator, data-flow, vendor, hosting-region and retention facts remain unverified.",
    "Qualified Hong Kong counsel must review fact-specific disclosure, publication and retention decisions."
  ],
  "noStagedFiles": false,
  "diffSummary": "Created one external research artifact; no repository diff was made.",
  "reviewFindings": [
    "blocker: requested GitHub and git lifecycle actions could not be performed without a shell/gh/git tool",
    "no blocker found in the substantive research brief; legal review remains explicitly required"
  ],
  "manualNotes": "The parent can copy this artifact to docs/research/review-privacy-obligations.md, run the requested GitHub workflow, and update acceptance evidence after independent review."
}
```
