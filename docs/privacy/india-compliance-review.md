# India Privacy and Communications Review

**Status:** Engineering issue list, not legal advice. Legal owner/counsel must review before launch. Source verification date: 2026-10-27.

## DPDP Act and Rules
MeitY's official material lists the Digital Personal Data Protection Rules, 2025 and an enforcement timeline. The Act's commencement is phased by notification; do not assume every substantive provision commenced on publication. Counsel must map the exact sections/rules in force on launch date, the platform's role as Data Fiduciary/Data Processor in each workflow, notice/consent basis, rights handling, breach response, retention, processor contracts and children's-data obligations.

Official sources:
- MeitY, Digital Personal Data Protection Rules 2025: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
- Gazette commencement notification: https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf

## TRAI / SMS
TRAI's sender guidance states that bulk messaging senders may need Principal Entity registration, headers, content-template registration, transmission of required identifiers, and consent processes where applicable under TCCCPR and access-provider rules. Event invitation messaging classification is fact-specific; do not assume every wedding invitation is a transactional/service message. Validate with the selected telecom provider and counsel before launch.

Official source: https://www.trai.gov.in/advice-to-senders

## WhatsApp
Use official WhatsApp Business Platform or an authorized provider only. Verify current Meta policies, opt-in expectations, templates, service windows, business verification, pricing, quality limits and webhook requirements directly before integration. Do not treat a phone number in a guest spreadsheet as blanket authorization for promotional marketing.

## Data minimization and children
Avoid collecting child names, birth dates, health details or identity documents unless there is a necessary, justified feature. Adult/child meal counts should be sufficient for catering. Dietary/accessibility free text should be optional, restricted and retained only as long as needed.

## Required controls
- Clear organizer terms: organizer confirms authority to upload and contact invitees.
- Separate event communications from product promotions.
- Record source, purpose, timestamp and scope of communication authorization/consent where applicable.
- Support suppression/opt-out and propagate it before dispatch.
- Provide privacy notice and contact for rights requests.
- Document processors, subprocessors, retention and deletion.
- Legal review of international transfers, incident reporting, children's data and vendor contracts.

## Added launch gates — consent and vendor exports
- Treat organizer authority to share a guest contact and channel-specific permission to message as separate checks; phone-number possession or spreadsheet upload alone is not proof of opt-in.
- Keep event-related invitations separate from ShaadiCount marketing. Do not reuse event contacts for promotions without a separately reviewed lawful basis/permission.
- At every dispatch, re-check suppression and current authorization status. Provide an organizer-visible suppression list without exposing unnecessary reasons to collaborators.
- Exports for caterers should default to aggregated headcounts. Names, phone numbers, dietary notes and other personal data require a documented purpose, host authorization and least-privilege access.
- Re-check the latest DPDP commencement notifications, rules and applicable TRAI/access-provider requirements with counsel at the actual launch date; this document is not a legal determination.
