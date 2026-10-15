# Subprocessors (draft, fill in before signing the first client)

| Subprocessor | Purpose | Data | Location | Status |
|---|---|---|---|---|
| Hosting provider (TBD, choose an EU datacenter) | VPS: app, database, uploads, backups | All customer-conversation data | EU | to decide |
| Backup storage (TBD, EU object storage) | Off-site encrypted backups | Database and uploads | EU | to decide |
| Email provider (TBD, EU SMTP) | Outgoing notification and reply email | Recipient address, message text | EU | to decide |
| Anthropic (Claude API), only if the client enables the AI assistant | Draft or send FAQ answers | Only the single customer message text, no name, email or history | **USA** | per client, opt-in. Needs a transfer mechanism (EU-US Data Privacy Framework / standard contractual clauses): verify Anthropic's current DPA and zero-retention options before use |
| Meta (WhatsApp Cloud API) | WhatsApp messaging | Messages, phone numbers | Meta infrastructure | **the client's own** contract with Meta, not Domli's subprocessor, but state this in the DPA |
| OnlineAfspraken.nl | Appointments | Names/times if API mode is used | NL | **the client's own** supplier |

Notify clients before adding or replacing a subprocessor (period agreed in the DPA, e.g. 30 days).
