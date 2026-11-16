# Jaay: Bitcoin point of sale and credit book for market sellers

*Jaay* means "sell" in Wolof. Jaay is a phone app for small traders in Dakar's markets: you type a price in **CFA francs**, the customer scans a QR code and pays in **bitcoin** (on-chain or **Lightning**), and the sale is recorded. A **credit book** ("carnet de dettes") tracks who owes what, and you can write notes in plain French or English: *"Vendu 3 sacs de riz à 15000"*, *"Awa doit 2500 pour le poisson"*.

> **Test network only.** Jaay runs on Bitcoin **signet**: test coins with no value. Do not send real bitcoin to it.

## The problem
- Many sellers already sell on credit and track it in a paper notebook or in their head. Debts are forgotten and disputes are common.
- Mobile money fees eat into thin margins, and many cross-border customers can't use local mobile money.
- Bitcoin wallets show prices in BTC or USD and assume fast data; sellers think in CFA and often have slow, expensive mobile data.

## What Jaay does
| | |
|---|---|
| **Sell in CFA** | Keypad in FCFA; converted to sats live. XOF is pegged to the euro (655.957 XOF = 1 EUR), so only BTC/EUR is needed. |
| **Get paid** | A QR code for a fresh signet address (BIP21 with amount) or a **Lightning invoice** from the seller's own wallet via **Nostr Wallet Connect (NIP-47)**. Jaay watches for the payment and shows a big ✔ "Payé!" with a vibration. |
| **Your keys, your phone** | A real HD wallet: BIP39 12-word phrase, BIP84 native segwit, built with the audited `@scure` libraries. The phrase is encrypted with your PIN (PBKDF2-SHA256, 310k rounds + AES-256-GCM) and never leaves the device. Send, receive and check your balance. |
| **Cash too** | One tap records a cash (*Espèces*) sale, so the day's ledger is complete, not just the bitcoin part. |
| **Quick-sell catalogue** | Save "Thiof · 3 000" once; next time it's one tap to charge. |
| **Credit book** | Who owes what, with history per customer. Turn a debt into a payment request with one tap, or record a cash repayment. |
| **WhatsApp, the way the market already talks** | Send a receipt after a sale, or a polite reminder to a customer who owes money. The reminder carries a **payment link** (`/pay?…`) that opens a QR page on the customer's phone. The link holds only a public address and an amount; the server stores nothing. |
| **Encrypted backup over Nostr** | A Nostr key is derived from the same 12 words (**NIP-06**). The sales and credit book are encrypted to that key (**NIP-44**) and published as a replaceable app-data event (kind 30078) to several relays. Lose the phone: the 12 words bring back the money *and* the credit book. Relays only see ciphertext. |
| **Plain-language and voice notes** | Write or **say** "Vendu 2 sacs à 10 000" or "Moussa a payé 1000" and Jaay does the right thing. An AI reads the note, and its answer is validated in code. Without AI an offline parser handles French and English, so the app never depends on it. |
| **Reports** | Today's totals, a split by payment method, a 7-day chart, and a **CSV export** for a savings group (*tontine*) or an accountant. Formula injection is neutralised. |
| **Made for cheap phones** | Small app, installs to the home screen (PWA), opens offline, keeps the last exchange rate for offline pricing, big buttons, French by default with English available, light and dark mode. |

## Try it
- **Live:** https://jaay-r9za.onrender.com (signet). Tap *Créer mon portefeuille*, write down the 12 words, choose a PIN, sell.
- **Test coins:** get signet bitcoin from https://signetfaucet.com/ and send them to the address in *Portefeuille*.
- **Lightning (optional):** in *Réglages*, paste a `nostr+walletconnect://…` string from a wallet that supports NWC (e.g. Alby Hub, Coinos) set to a test network.

## Run it (one command)
```bash
npm install && npm start          # http://localhost:3000
```
or with Docker:
```bash
docker build -t jaay . && docker run -p 3000:3000 jaay
```
Optional: copy `.env.example` to `.env` and set `GEMINI_API_KEY` to let an AI read notes; without it the offline parser is used.

Tests: `npm test`, 27 tests covering BIP84 and NIP-06 test vectors, PIN encryption, coin selection and signing, CFA conversion, note parsing, pay links, WhatsApp text, reports and CSV injection, the encrypted Nostr backup (no plaintext leaks, wrong-key rejection, merge without address reuse), server security headers, rate caching and AI-output validation.

## Architecture
```mermaid
flowchart LR
  subgraph Phone["Seller's phone (PWA)"]
    UI["Sell · Credit book · Wallet · Settings"]
    WAL["HD wallet<br/>BIP39/BIP84 · @scure/btc-signer<br/>signs locally"]
    VAULT[("localStorage<br/>PIN-encrypted phrase (AES-GCM)<br/>sales + credit book")]
    UI --> WAL --> VAULT
  end
  UI -- "GET /api/rate · POST /api/assist (note text only)" --> SRV["Jaay server (Node/Express)<br/>CSP · rate limit · no storage"]
  SRV -- "BTC/EUR" --> MP["mempool.space prices"]
  SRV -. "optional" .-> AI["Gemini (structured JSON,<br/>validated in code)"]
  WAL -- "addresses, signed tx" --> ESP["Esplora API<br/>(mempool.space/signet)"]
  UI -- "NIP-47 make_invoice / lookup_invoice<br/>(NIP-04 encrypted)" --> RELAY["Nostr relay"] --> LN["Seller's own Lightning wallet"]
  VAULT -- "NIP-44 encrypted ledger (kind 30078)<br/>key from the 12 words (NIP-06)" --> BR["Nostr relays<br/>(backup)"]
  UI -- "WhatsApp: receipt / reminder + pay link" --> CUST["Customer phone<br/>/pay page (QR, no account)"]
```

**What the server never sees:** keys, the recovery phrase, balances, the sales history, the credit book or customers' phone numbers. It only serves the app, a cached exchange rate, and (optionally) reads a single note.

## Security by design
- **Threat model.** Lost or stolen phone → the phrase is encrypted with the PIN, and the app auto-locks after 5 minutes. Malicious server → it holds no keys and is not in the signing path. Network observer → HTTPS only, and only public addresses are queried. Prompt injection in notes → the AI output must match a strict schema, is re-validated in code (kind, amount ≤ 10M FCFA, customer required for credit), and the AI can never move money.
- **Least privilege.** Lightning uses an NWC connection the seller creates and can revoke in their own wallet. Jaay only calls `make_invoice`, `lookup_invoice` and `get_info`, so set a budget of 0 for sending.
- **Safe defaults.** Strict Content-Security-Policy (no inline scripts), `nosniff`, `no-referrer`, 4 KB JSON limit, per-IP rate limit, no request bodies in logs, mainnet addresses rejected, dust-safe change handling.
- **Proven libraries.** `@scure/bip39`, `@scure/bip32`, `@scure/btc-signer`, `@noble/hashes` (audited, pure JS) and `nostr-tools`.
- **No false "paid".** A payment only counts if it is a *new* transaction to that request's address, paying at least 98% of the amount.

## Who it's for and how we'd measure impact
The primary user is a market seller (cloth, fish, grains) with a mid-range Android phone. What we'd track in a pilot:
- sales recorded per seller per week
- share of credit repaid within 30 days
- time to complete a payment
- payments that fail or time out

## Limitations (honest)
- Signet only. Mainnet needs an external security review and a backup-recovery drill with real users.
- The on-chain wallet scans a small address gap (5); heavy users would need an indexer or descriptor sync.
- Lightning depends on the seller having an NWC-capable wallet.
- No Wolof interface yet; French and English only.

## Next
- Wolof voice notes.
- SMS or Nostr DM reminders to customers who owe money.
- Shared credit books for family businesses.
- Lightning-address tips.
- A mainnet beta with a local partner.

## License
MIT
