# Next Arc 🎌

> Swipe-based anime discovery — find anime you'll actually love.
> Live at: **discoveranime.com**

---

## What Is This?

Next Arc is a web app that lives at discoveranime.com. You swipe through 15 anime during a quick taste check, the app learns what you like, then serves personalised recommendations one at a time. Swipe right to get streaming links, swipe left to skip.

It runs entirely in your browser — there's no server to manage, no database, no monthly costs. It's just a folder of files hosted for free on GitHub.

---

## Your Files

Make sure your project folder has all of these before you start:

```
Next Arc/
├── index.html
├── animeTasteEngine.js
├── manifest.json
├── sw.js
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## Part 1 — Create a Free GitHub Account

If you don't have one already:

1. Go to **https://github.com**
2. Click **Sign up** in the top right
3. Enter your email, create a password, and choose a username
4. Verify your email address when GitHub sends you a confirmation email
5. On the "What kind of work do you do?" screen, you can skip the questions — just scroll to the bottom and click **Continue**
6. Choose the **Free** plan

---

## Part 2 — Create Your Repository

A repository (repo) is just a folder on GitHub where your files live. Think of it like a Google Drive folder, but for code.

1. Once logged in, click the **+** button in the top right corner of GitHub
2. Click **New repository**
3. Fill in the form:
   - **Repository name:** `nextarc` (no spaces, all lowercase)
   - **Description:** Anime discovery web app (optional)
   - **Public** — make sure this is selected (required for free hosting)
   - **Do NOT** tick "Add a README file" — leave all checkboxes unticked
4. Click **Create repository**

You'll land on an empty repo page. Keep this tab open.

---

## Part 3 — Upload Your Files

You don't need to install anything. You can upload files directly in the browser.

1. On your empty repo page, you'll see a link that says **"uploading an existing file"** — click it
2. Open the Finder on your Mac and navigate to your Next Arc project folder
3. Select **all the files and the icons folder** at once:
   - Click on `index.html`
   - Hold **Cmd** and click `animeTasteEngine.js`, `manifest.json`, `sw.js`, and `README.md`
   - Drag them all into the GitHub upload area in your browser
4. **For the icons folder:** GitHub doesn't let you drag a whole folder in one go. After uploading the files above, click **"choose your files"**, then navigate into your `icons` folder and select both `icon-192.png` and `icon-512.png`
5. Scroll down to the **"Commit changes"** section
   - Leave the message as-is or type something like `Upload Next Arc files`
6. Click **Commit changes**

All your files are now on GitHub. ✅

---

## Part 4 — Turn On GitHub Pages (Free Hosting)

GitHub Pages takes your files and turns them into a live website for free.

1. In your repo, click **Settings** (the tab with a gear icon, near the top of the page)
2. In the left sidebar, scroll down and click **Pages**
3. Under **"Build and deployment"**, find the **Source** dropdown
4. Select **Deploy from a branch**
5. Under **Branch**, select **main** and make sure the folder is set to **/ (root)**
6. Click **Save**

GitHub will take about 1–2 minutes to build your site. You'll see a green banner at the top of the Pages settings that says:

> "Your site is live at https://YOUR_USERNAME.github.io/nextarc/"

Click that link to confirm your app is working before moving on to the custom domain step.

---

## Part 5 — Connect discoveranime.com

This is the part that makes your app load at **discoveranime.com** instead of the long github.io URL. You'll need to do two things: tell your domain registrar to point to GitHub, and tell GitHub what your domain is.

### 5a — Find Your Domain's DNS Settings

Log in to wherever you bought discoveranime.com (Namecheap, GoDaddy, Cloudflare, Squarespace, etc.). Every registrar looks a little different, but you're looking for a section called **DNS**, **DNS Management**, **Name Servers**, or **DNS Records**. This is where you add the records below.

### 5b — Add GitHub's DNS Records

You need to add **4 A records** and **1 CNAME record**. An A record points your domain to an IP address. Here's exactly what to enter:

| Type  | Host / Name | Value                  |
|-------|-------------|------------------------|
| A     | @           | 185.199.108.153        |
| A     | @           | 185.199.109.153        |
| A     | @           | 185.199.110.153        |
| A     | @           | 185.199.111.153        |
| CNAME | www         | YOUR_USERNAME.github.io |

> Replace `YOUR_USERNAME` with your actual GitHub username in the CNAME row.
>
> The `@` symbol means the root domain (discoveranime.com itself). Some registrars use `@`, some leave the field blank — use whichever your registrar shows.

After saving, DNS changes can take anywhere from **5 minutes to 24 hours** to fully spread across the internet. Usually it's under an hour.

### 5c — Tell GitHub About Your Domain

1. Go back to your repo on GitHub
2. Click **Settings** → **Pages** (same place as before)
3. Under **"Custom domain"**, type: `discoveranime.com`
4. Click **Save**
5. GitHub will check your DNS settings — this is called DNS verification. If DNS hasn't spread yet, you'll see a warning — just wait 15–30 minutes and refresh the page.
6. Once verified, tick the **"Enforce HTTPS"** checkbox. This gives your site a padlock and makes it secure.

Your site is now live at **https://discoveranime.com** 🎉

---

## Part 6 — Install on Your Phone

Once the site is live, you can add it to your phone's home screen so it opens like a regular app — no App Store needed.

### iPhone / iPad (Safari only — must use Safari, not Chrome)

1. Open **Safari** and go to **discoveranime.com**
2. Tap the **Share** button — it's the box-with-arrow icon at the bottom of the screen
3. Scroll down in the share sheet and tap **"Add to Home Screen"**
4. Change the name to **Next Arc** if you like, then tap **Add**
5. It appears on your home screen and opens full-screen with no browser address bar

### Android (Chrome)

1. Open **Chrome** and go to **discoveranime.com**
2. Tap the **three-dot menu** in the top right
3. Tap **"Add to Home Screen"** or **"Install app"**
4. Tap **Install**
5. It appears on your home screen just like a downloaded app

---

## Making Changes Later

If you ever want to update the app (change colours, add features, etc.), the process is:

1. Edit the file on your computer
2. Go to your repo on GitHub
3. Click on the file you want to update
4. Click the **pencil icon** (Edit) in the top right of the file view
5. Paste in your updated code
6. Scroll down and click **Commit changes**

GitHub Pages automatically rebuilds the site within a minute or two.

---

## Troubleshooting

**The site shows a 404 error:**
Make sure GitHub Pages is enabled (Settings → Pages) and that the branch is set to `main` at root `/`. Wait 2 minutes and refresh.

**discoveranime.com isn't loading yet:**
DNS can take up to 24 hours to spread. While you wait, your app is still accessible at the `github.io` URL from Part 4.

**No anime cards are appearing:**
The app calls the AniList API to fetch anime — make sure you have an internet connection. If it still doesn't work, try refreshing the page.

**GitHub says "DNS check unsuccessful":**
Your DNS records haven't spread yet. Wait 30 minutes and click Save again in the Pages settings.

**The HTTPS / padlock isn't showing:**
After setting your custom domain, wait a few minutes for GitHub to generate your SSL certificate, then tick "Enforce HTTPS" in the Pages settings.

---

## How the App Works (the short version)

- **Taste check:** You swipe 15 anime. Each like adds points to the genres and tags of that anime in your taste profile. Dislikes subtract points.
- **Recommendations:** The app scores hundreds of anime against your taste profile using a similarity algorithm, then serves them highest-first.
- **Wildcards:** Every 5th recommendation is a curveball outside your usual taste — keeps things interesting.
- **Streaming links:** When you swipe right on a rec, a popup shows which streaming services carry it (Crunchyroll, Netflix, etc.) with direct links.

---

## Costs

| Thing | Cost |
|---|---|
| GitHub hosting | Free |
| AniList API | Free |
| discoveranime.com domain | Whatever you paid at your registrar (~$10–15/year) |
| SSL certificate | Free (GitHub handles it) |
