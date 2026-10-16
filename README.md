<!-- Created and modified by Claude (model: Claude Sonnet 5.5, Anthropic). AI-generated documentation: review before relying on it. -->
# Meeting Finder

A When2Meet / Doodle style scheduler that runs entirely in the browser. There is no server and no build step: four static files hosted on GitHub Pages.

- **Organiser** chooses the time slots, a Google Drive folder and an email address, and gets a participant link. Slots come in two styles:
  - **Time grid (When2Meet style):** regular slots on every chosen day; participants paint the slots that suit them.
  - **Pick individual slots (Doodle style):** you list the exact options, each with its own date, start time and length; participants answer OK / Acceptable / No per option. Best when there are only a few candidates, and it keeps the link short.
- **Participants** enter a name, check their time zone (detected from the browser, changeable), and mark each slot **OK**, **Acceptable** or **No**. Answers are saved to the Drive folder, sent by email (`mailto:`), or downloaded as a file.
- **Organiser results** show a heatmap of attendance per slot, the best options, and who has not answered.

## How privacy works

The page on GitHub Pages is public, but it is only generic code. The whole meeting definition (title, slots, folder ID, email address, participant names) is stored in the URL fragment (after `#`), which browsers never send to the web server. The answers live in your Drive folder and are protected by Drive permissions, not by the link being secret. Treat the participant link like a shared document link.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `test.js` | Node tests for the logic (`node test.js`, Node 18+) |

## Setup

### 1. Publish on GitHub Pages

Push the files to a repository, then enable Pages (Settings, Pages, deploy from branch). Your site will be at `https://<user>.github.io/<repo>/`.

At this point the app already works with the **email and file fallback only**. Steps 2 and 3 add Google Drive.

### 2. Register a Google Cloud project (for Drive)

1. Create a project in the Google Cloud console.
2. Enable the **Google Drive API** and the **Google Picker API**.
3. Configure the **OAuth consent screen**: user type External, publishing status **Testing**. Add every participant's Google account as a **test user** (up to 100). This avoids Google's verification process; participants will see an "unverified app" warning and need to choose Continue.
4. Create an **OAuth client ID** of type Web application. Under authorised JavaScript origins add `https://<user>.github.io` (origin only, no path).
5. Create an **API key** and restrict it to the Picker API and to the HTTP referrer `https://<user>.github.io/*`.
6. Note the **project number** (Dashboard, project info).
7. Put the three values into the `GOOGLE` object at the top of `app.js`:
   ```js
   const GOOGLE = { clientId: '…', apiKey: '…', appId: '<project number>' };
   ```
   These values are public by design; the restrictions in steps 4 and 5 are what protect them.

### 3. Prepare a Drive folder

Create a folder in Google Drive and share it with the participants as **Editor**. The organiser's account owns the folder.

## Using it

1. Open the site, fill in the meeting, choose a slot style, paste the folder link (or use "Pick folder from Drive"), add the email address, and press **Create links**.
2. Send the first link to participants. Keep the **Results** link for yourself; the **Edit** link reopens the form.
3. Participants open the link, mark their slots and press **Save to Google Drive**. The first time, Google asks them to select the shared folder once (the app only has access to files it creates or that the person picks).
4. On the Results link press **Load answers from Drive**. Answers received by email can be pasted in, and downloaded `.json` files can be added with the file chooser.

Each participant writes their own file (`response-<meeting id>-<name>.json`), so there are no concurrent-write conflicts. Saving again with the same name replaces the earlier answer.

## Things to know

- Changing the dates, times or title creates a new meeting version; answers to older versions are ignored (and counted in a note).
- Participants in the Drive folder can see each other's answer files, as in When2Meet.
- The organiser reads answers with the read-only Drive scope (`drive.readonly`), which is why the OAuth app is kept in Testing mode for a known group.
- Email answers are a line starting with `WMRESP:` in the message body. If a mail client re-wraps that long line, ask the sender for the downloaded file instead.
- Times are stored in UTC, so every participant sees slots in their own time zone, including across daylight-saving changes.
- Slot limit: 1500 per meeting.
- In the Doodle style, the times you add are fixed instants; changing the time zone selector afterwards only changes how they are displayed in the list.

## Status

The pure logic (time zone conversion across DST, link encoding, grid layout in odd-offset zones, per-slot lengths, aggregation and ranking) is covered by `test.js`. The setup, participant and results views were also smoke-tested in a simulated browser (jsdom) for both slot styles. The Google Drive, Picker and sign-in code, and the real look and feel in a browser, have **not** been tried against a real Google project, so expect a first test round and some fixes there.
