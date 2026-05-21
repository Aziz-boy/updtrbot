
@updtrbot onsite at PU 8997849

@updtrbot onsite at DEL 8997849

@updtrbot checking BOL 8997849

@updtrbot checking POD 8997849

@updtrbot traffic 8997849

### 6. Forward a Driver Update
**Option A — Tag in the same message:**
Type the update text and tag the bot in one message
```
Load# 8997849
Status: Rolling
Current Loc: Chicago, IL
Miles left: 120
@updtrbot
```

**Option B — Reply to driver's message:**
Reply to the driver's message → tag bot
```
@updtrbot 8997849
```
Sends that exact message text to the broker.

---

## Bot replies
- `✓` — Email sent successfully
- `Load not found. Check number.` — Load number not in Gmail. Check it.
- `No files found. Reply to first photo.` — You didn't reply to a photo
- `Reply to first photo then tag me.` — For BOL/POD, must reply to first photo
- `Need a load number.` — You forgot the load number

---

## Rules
1. Load number must be in the message
2. For BOL/POD/traffic — always reply to the **first** photo the driver sent
3. Bot collects all photos between the first photo and your tag automatically
4. Load number must match the subject line of the email thread exactly

---

## Examples of load numbers
- Regular: `8997849`
- With dash: `31426-50165`

Both formats work.

---

## Quick reference
| Situation | Command |
|---|---|
| Arrived at pickup | `@updtrbot onsite at PU [load#]` |
| Arrived at delivery | `@updtrbot onsite at DEL [load#]` |
| Picked up, sending BOL | Reply to first BOL photo → `@updtrbot checking BOL [load#]` |
| Delivered, sending POD | Reply to first POD photo → `@updtrbot checking POD [load#]` |
| Traffic photos | Reply to first photo → `@updtrbot traffic [load#]` |
| Driver status update | Tag bot in message with update text + load# |
