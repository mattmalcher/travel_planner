---
name: sncf-timetables
description: "Use this skill when someone asks about French train times, schedules, or timetables — especially when they want a week-at-a-glance view rather than a single journey. Covers: finding SNCF TER, Intercités, and TGV timetables without using SNCF Connect's date picker; downloading official fiche horaire PDFs; understanding why SNCF Connect shows 'no trains'; distinguishing short-turn services; and resolving conflicting frequency figures from aggregators."
---

# Finding French Train Timetables (SNCF)

## Core insight

SNCF Connect is a **booking engine**, not a timetable viewer. It requires a date and shows only matching journeys. For a full week-at-a-glance schedule, use the **fiche horaire PDF** instead — the official poster displayed at stations, free to download, showing every train, every stop, and all day-types (weekday / Saturday / Sunday / holiday) on one or two pages.

---

## Decision tree

```
User wants train times for a French route
│
├─ Full weekly schedule / "what trains run on this line?"
│   └─ → Fiche horaire PDF  (see §1)
│
├─ Next few departures from a specific station
│   └─ → Station departure board  (see §2)
│
├─ "No trains showing on SNCF Connect"
│   └─ → Booking horizon issue  (see §3)
│
└─ Need to book / pay
    └─ → SNCF Connect, Trainline, or Rail Europe  (date-based, fine for booking)
```

---

## §1 — Fiche horaire PDFs (best for full timetables)

**Two official access points:**

| Portal | URL | Best for |
|---|---|---|
| SNCF TER national hub | `ter.sncf.com/<region>/se-deplacer/fiches-horaires` | Searching by line or commune |
| Regional transport authority | `transports.<region>.fr/se-deplacer/horaires-et-plans` | Co-branded mirror; sometimes better search |
| Raw PDF host | `ter-fiches-horaires.sncf.fr` | Direct URL if you know the line name |

**Region name in URL follows the administrative region**, e.g.:
- Nouvelle-Aquitaine → `ter.sncf.com/nouvelle-aquitaine/...`
- Occitanie → `ter.sncf.com/occitanie/...`
- Grand Est → `ter.sncf.com/grand-est/...`
- PACA → `ter.sncf.com/paca/...`

**How to find a specific line PDF:**
1. Go to the TER fiches-horaires page for the correct region.
2. Search by departure or arrival commune — the site returns the matching line(s).
3. Download the PDF. Check the **validity dates** printed at the top; timetables change roughly mid-December and early July each year.

**What the PDF contains:**
- Every train number and its stops, in both directions
- Columns for Lun–Ven (weekday), Samedi, Dimanche/fêtes
- Footnotes for seasonal, Friday-only, or short-turn services
- Planned engineering works / substitution buses
- Connection notes (e.g. TGV at Bordeaux)

---

## §2 — Station departure boards (next departures, no date needed)

For real-time next-departures without a journey search:

- **TER:** `ter.sncf.com/<region>/se-deplacer/prochains-departs/<station-slug-UIC>`
- **All SNCF:** `garesetconnexions.sncf/en/stations-services/<station>/timetables`

The station slug is usually the station name lowercased with hyphens; the UIC code (8-digit number) is also accepted. A quick web search for `"SNCF prochains departs" <station name>` resolves ambiguity fast.

---

## §3 — "No trains" on SNCF Connect

**Cause:** SNCF Connect opens booking roughly 3–5 months ahead; TER bookings open later than TGV. After the mid-December timetable change, new-season data loads gradually — trains exist but the booking system hasn't published them yet.

**Resolution:** Use the fiche horaire PDF, which covers the full validity window from day one. If the PDF shows trains but SNCF Connect shows none, advise the user to try again closer to the travel date or book at the station on the day.

---

## §4 — Short-turn services and service codes

Many TER lines have short-turn variants that don't run the full route. Common naming patterns:

| Code prefix | Meaning |
|---|---|
| L | Full-line service ("Liné'R") |
| F | Short-turn / frequent shuttle ("Facilit'R") |
| Line number alone | Standard service |

Always check the **destination column** in the fiche horaire — a train that stops at intermediate stations may terminate short of the user's destination.

---

## §5 — Conflicting frequency figures from aggregators

Omio, Rome2Rio, Trainline, and SNCF Connect itself often give different "X trains per day" counts for the same route. Causes:

- Some count short-turn services as separate trains; others don't.
- Seasonal / Friday-only trains may or may not be included.
- Aggregators may cache old data.

**Rule:** trust the official fiche horaire PDF for the definitive count. Treat aggregator figures as ballpark only.

---

## §6 — Intercités and TGV (non-TER routes)

TER timetables use the regional fiches-horaires system above. For mainline services:

| Service type | Timetable source |
|---|---|
| TGV / Intercités | `sncf-voyageurs.com` → "Horaires" or search for the route + "fiche horaire PDF" |
| All SNCF (machine-readable) | GTFS/NeTEx on `transport.data.gouv.fr` — dataset "Horaires SNCF" |
| Night trains (Intercités de Nuit) | Same regional/national portals; check "fiche horaire Intercités" |

---

## §7 — Worked example (Bayonne → Saint-Jean-Pied-de-Port)

1. **Identify the line:** TER Line 54, region Nouvelle-Aquitaine.
2. **Go to:** `ter.sncf.com/nouvelle-aquitaine/se-deplacer/fiches-horaires`
3. **Search:** "Bayonne" or "Saint-Jean-Pied-de-Port" → returns Line 54 PDF.
4. **Download:** PDF valid 14 Dec 2025 – 3 Jul 2026 (next edition from ~3 Jul 2026).
5. **Read:** ~6 weekday and ~5 weekend round trips; journey ≈ 1 hour; F54 short-turns terminate at Cambo-les-Bains.
6. **Book:** flat TER fare from ~€5; buy on SNCF Connect, Trainline, or at the station machine.

---

## Quick-reference checklist

- [ ] Identify the **region** (administrative, not département)
- [ ] Go to **`ter.sncf.com/<region>/se-deplacer/fiches-horaires`**
- [ ] Search by **commune** and download the **PDF**
- [ ] Check **validity dates** at top of PDF
- [ ] Note any **short-turn service codes** (F / L / footnotes)
- [ ] For booking only, then use **SNCF Connect / Trainline**
- [ ] If SNCF Connect shows nothing → **booking horizon issue**, not cancellation
