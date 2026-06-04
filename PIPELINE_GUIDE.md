# Next Arc — Recommendation Pipeline: Complete Beginner Guide

## What is this guide?

This guide walks you through building a system that makes Next Arc's recommendations dramatically smarter. Right now the app guesses what you might like based on basic signals. After this pipeline is built, every recommendation will be backed by:

- **AniDB weighted tag scores** — community-voted percentages for how much a show contains a given theme
- **AniList tags, scores, staff, and user recommendations** — broad coverage and collaborative signals
- **Reviews from both sources** — what real viewers say about each show
- **Episode descriptions** — the full text of every episode summary, not just the synopsis
- **NLP processing** — keyword extraction, topic modelling, and sentence embeddings that capture what shows are "about" in a mathematical way that a computer can compare

**You do not need any programming experience to follow this guide.** Every command is written out exactly as you should type it. Every file is explained before you create it.

---

## What is Terminal?

Terminal is a Mac app that lets you control your computer by typing commands instead of clicking. You'll use it throughout this guide.

To open it: press **Cmd + Space**, type **Terminal**, press **Enter**.

When you see a code block like this:
```
some command here
```
That means you should type or paste it into Terminal and press **Enter**. Do one command at a time and wait for each one to finish before running the next.

**Important rule:** Never paste file contents directly into Terminal. Only paste commands. If you paste a block of text that looks like a file and Terminal says "command not found", that's what happened — close Terminal, reopen it, and paste only the command.

---

## What is a Python script?

A Python script is a plain text file ending in `.py` that contains instructions a computer can run. You'll create several of these. Each one does a specific job: fetching data, merging it, processing it, or uploading it.

To run a script you type `python3 filename.py` in Terminal.

---

## Overview: what you'll build

You'll create a folder on your Desktop called `nextarc-pipeline` containing several Python scripts. You run them once in order and they:

1. Download anime data from AniList (free, no account needed)
2. Download reviews from AniList
3. Download detailed data from AniDB (requires a free account — setup covered in Step 7)
4. Merge everything into one combined record per anime
5. Run NLP to extract keywords, topics, and embeddings from all the text
6. Upload the processed data to your existing Firebase database

After that, a Cloud Function in Firebase automatically recomputes recommendations every time a user rates something.

**Total cost: $0. Time to run all scripts: ~12 hours (mostly overnight AniDB fetch).**

---

## Step 1 — Create your project folder

This folder is where all your pipeline scripts and data will live. It is separate from your anime app folder.

Open Terminal and run these commands one at a time, pressing Enter after each:

```
mkdir ~/Desktop/nextarc-pipeline
```

```
cd ~/Desktop/nextarc-pipeline
```

`mkdir` creates the folder. `cd` moves Terminal into that folder so everything you do next happens inside it.

Now create the data subfolder where all downloaded data will be saved:

```
mkdir data
```

To confirm you are in the right place:
```
pwd
```

You should see `/Users/jacobsarradet/Desktop/nextarc-pipeline` printed back.

**Note:** If Terminal says `mkdir: nextarc-pipeline: File exists`, that is fine — the folder already exists. Just run the `cd` command to move into it.

---

## Step 2 — Install Python packages

Python packages are pre-built tools other developers wrote that you can use in your scripts. You install them once and they are available forever.

Run this command (it is one long line — copy the whole thing):

```
pip3 install requests firebase-admin scikit-learn sentence-transformers transformers torch tqdm python-dotenv
```

This will take several minutes. You will see a lot of text scrolling by — that is normal. Wait until you see your terminal prompt again (the line ending in `%`).

When it finishes, verify everything installed correctly:

```
python3 -c "import requests, firebase_admin, sklearn, sentence_transformers, transformers, torch, tqdm, dotenv; print('All good!')"
```

You should see `All good!` printed. If you see an error message instead, copy it and share it so we can fix it before continuing.

**What each package does:**
- `requests` — makes API calls to AniList and AniDB
- `firebase-admin` — writes data to your Firebase database
- `scikit-learn` — TF-IDF keyword extraction and LDA topic modelling
- `sentence-transformers` — converts text into embedding vectors
- `transformers` — sentiment analysis on reviews
- `torch` — required by the above two
- `tqdm` — shows progress bars while scripts run
- `python-dotenv` — loads your Firebase credentials from a file

---

## Step 3 — Connect to your Firebase project

You already have a Firebase project set up for Next Arc. The pipeline scripts need a special key to write data to it.

### 3.1 Download your service account key

This key gives the Python scripts permission to write to your Firestore database.

1. Go to https://console.firebase.google.com
2. Click on your Next Arc project
3. Click the **gear icon** in the left sidebar → **Project settings**
4. Click the **Service accounts** tab
5. Click the blue **Generate new private key** button
6. Click **Generate key** in the popup
7. A `.json` file will download to your Downloads folder
8. Open Finder, go to Downloads, find the file (it has a long name ending in `.json`)
9. Drag it into your `nextarc-pipeline` folder on the Desktop
10. Right-click the file → Rename → type `firebase-key.json` → press Enter

### 3.2 Find your Project ID

1. In Firebase, go to **Project settings → General**
2. Look for **Project ID** near the top — it looks something like `next-arc-b091b`
3. Copy it exactly

### 3.3 Create your .env file

The `.env` file stores your credentials so the scripts can find them. You will create it with two Terminal commands — make sure you are still in your `nextarc-pipeline` folder first (run `pwd` to check).

Run these two commands one at a time. In the second command, replace `your-project-id-here` with the actual Project ID you copied:

```
echo "FIREBASE_KEY_PATH=firebase-key.json" > .env
```

```
echo "FIREBASE_PROJECT_ID=next-arc-b091b" >> .env
```

The first command (`>`) creates the file. The second command (`>>`) adds a line to it. Do not mix them up.

Verify it was created correctly:

```
cat .env
```

You should see two lines:
```
FIREBASE_KEY_PATH=firebase-key.json
FIREBASE_PROJECT_ID=your-project-id-here
```

If you see your actual project ID on the second line, you are good.

### 3.4 Create your .gitignore file

This file tells Git to never upload your secret key or large data files to GitHub. Run these commands one at a time:

```
echo "firebase-key.json" > .gitignore
```

```
echo ".env" >> .gitignore
```

```
echo "__pycache__/" >> .gitignore
```

```
echo "*.pyc" >> .gitignore
```

```
echo "data/" >> .gitignore
```

Verify:
```
cat .gitignore
```

You should see five lines printed back.

---

## Step 4 — How to create script files

Each script in this guide needs to be saved as a `.py` file in your `nextarc-pipeline` folder. Here is how to do that:

1. Open **TextEdit** on your Mac — press **Cmd + Space**, type **TextEdit**, press **Enter**
2. Go to **Format → Make Plain Text** — this step is required. Rich text mode will silently corrupt the script and cause confusing errors.
3. Copy the entire script from this guide — start from the first `import` line, end at the last line. Do not include the triple backticks (` ``` `) at the top and bottom.
4. Paste it into TextEdit
5. Go to **File → Save**
6. In the save dialog, click the dropdown next to "Where" and navigate to Desktop → `nextarc-pipeline`
7. In the "Save As" field, type the exact filename shown (e.g. `fetch_anilist.py`)
8. Make sure the file format at the bottom says **Unicode (UTF-8)**
9. Uncheck **"If no extension is provided, use .txt"** if you see that option
10. Click **Save**

To verify the file was saved correctly, go back to Terminal and run:
```
ls
```
You should see the filename appear in the list.

Repeat for each script in this guide.

---

## Step 5 — Fetch anime data from AniList

AniList has a free public API — no account or key needed.

**What this script fetches:** every anime on AniList including tags, genres, scores, staff (director, composer), source material type, format, relations, and user recommendations.

**Why multiple passes?** AniList's API has a hard ceiling of 5,000 results per query. A single query sorted by popularity would cut off and miss thousands of anime. To get the complete catalogue (~15,000–18,000 anime), this script runs five passes using different filters and sort orders, then deduplicates everything by ID so no anime is counted twice.

The five passes are:
1. **Year + popularity** — fetches every year from 1960 to now, sorted by popularity. Gets the vast majority.
2. **Year + score** — same year loop, sorted by score. Catches critically acclaimed but less popular shows.
3. **Year + favourites** — same year loop, sorted by community favourites. Catches beloved niche shows.
4. **No-year gap fill** — runs 7 different sort orders with no year filter, catching anime that have no year set in AniList's database (some older or obscure titles have incomplete metadata).
5. **Status sweep** — fetches all RELEASING, FINISHED, NOT_YET_RELEASED, CANCELLED, and HIATUS anime regardless of year. Final safety net.

Create a file called `fetch_anilist.py` with this content:

```python
import requests
import json
import time
import os
from tqdm import tqdm

ANILIST_URL = "https://graphql.anilist.co"

# The fields we want for every anime — defined once and reused across all queries
MEDIA_FIELDS = """
      id
      idMal
      title { romaji english }
      description(asHtml: false)
      tags { name rank isMediaSpoiler }
      genres
      source
      format
      duration
      averageScore
      popularity
      episodes
      status
      season
      seasonYear
      studios(isMain: true) { nodes { name } }
      staff(sort: RELEVANCE, perPage: 10) {
        edges {
          role
          node { id name { full } }
        }
      }
      relations {
        edges {
          relationType
          node { id idMal type }
        }
      }
      recommendations(sort: RATING_DESC, perPage: 10) {
        nodes {
          rating
          mediaRecommendation { id idMal }
        }
      }
"""

# Query filtered by year and sort order
YEAR_QUERY = """
query ($page: Int, $year: Int, $sort: [MediaSort]) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, seasonYear: $year, sort: $sort, isAdult: false) {
""" + MEDIA_FIELDS + """
    }
  }
}
"""

# Query with no year filter — just sort order
NOYEAR_QUERY = """
query ($page: Int, $sort: [MediaSort]) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: $sort, isAdult: false) {
""" + MEDIA_FIELDS + """
    }
  }
}
"""

# Query filtered by status only
STATUS_QUERY = """
query ($page: Int, $status: MediaStatus) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, status: $status, isAdult: false) {
""" + MEDIA_FIELDS + """
    }
  }
}
"""

def api_request(query, variables, retries=5):
    """
    Make one API request with automatic retry on failure.
    Handles rate limits, timeouts, and bad responses gracefully.
    """
    for attempt in range(retries):
        try:
            response = requests.post(
                ANILIST_URL,
                json={"query": query, "variables": variables},
                headers={"Content-Type": "application/json"},
                timeout=30
            )

            if response.status_code == 429:
                print(f"\n  Rate limited — waiting 60s before retrying...")
                time.sleep(60)
                continue

            if response.status_code != 200:
                print(f"\n  HTTP {response.status_code} — waiting 5s before retrying...")
                time.sleep(5)
                continue

            data = response.json()

            if data.get("errors"):
                print(f"\n  API error: {data['errors']} — waiting 5s...")
                time.sleep(5)
                continue

            return data

        except requests.exceptions.Timeout:
            print(f"\n  Request timed out (attempt {attempt+1}/{retries}), retrying...")
            time.sleep(5)
        except Exception as e:
            print(f"\n  Unexpected error: {e} (attempt {attempt+1}/{retries}), retrying...")
            time.sleep(5)

    print(f"\n  Failed after {retries} attempts, skipping this request.")
    return None

def fetch_paginated(query, variables_fn, label=""):
    """
    Fetch all pages of a query. variables_fn is a function that takes a page
    number and returns the variables dict for that page.
    """
    results = []
    page = 1

    while True:
        variables = variables_fn(page)
        data = api_request(query, variables)

        if not data or not data.get("data") or not data["data"].get("Page"):
            break

        media_list = data["data"]["Page"].get("media") or []
        has_next = data["data"]["Page"]["pageInfo"]["hasNextPage"]

        results.extend(media_list)

        if not has_next:
            break

        page += 1
        time.sleep(0.7)  # stay comfortably under AniList's rate limit

    return results

def fetch_all_anime():
    # All anime stored here, keyed by AniList ID.
    # Using a dictionary means duplicates are automatically overwritten —
    # no anime will ever appear twice in the final output.
    all_anime = {}
    current_year = 2026

    # ── Pass 1: Year by year, sorted by popularity ──────────────────────────
    # This gets the bulk of the catalogue. Every year from 1960 to now,
    # paginated fully so there is no 5000-item ceiling per year.
    print("Pass 1/5: Year-by-year (popularity sort)...")
    for year in tqdm(range(1960, current_year + 1), desc="  Years"):
        results = fetch_paginated(
            YEAR_QUERY,
            lambda p, y=year: {"page": p, "year": y, "sort": ["POPULARITY_DESC"]},
        )
        for anime in results:
            all_anime[anime["id"]] = anime
        time.sleep(0.3)

    print(f"  → {len(all_anime)} unique anime after pass 1\n")

    # ── Pass 2: Year by year, sorted by score ───────────────────────────────
    # Catches critically acclaimed shows that appear lower in the popularity
    # rankings but higher when sorted by score.
    print("Pass 2/5: Year-by-year (score sort)...")
    added = 0
    for year in tqdm(range(1960, current_year + 1), desc="  Years"):
        results = fetch_paginated(
            YEAR_QUERY,
            lambda p, y=year: {"page": p, "year": y, "sort": ["SCORE_DESC"]},
        )
        for anime in results:
            if anime["id"] not in all_anime:
                all_anime[anime["id"]] = anime
                added += 1
        time.sleep(0.3)

    print(f"  → +{added} new anime. Total: {len(all_anime)}\n")

    # ── Pass 3: Year by year, sorted by favourites ──────────────────────────
    # Catches beloved niche shows that have passionate fanbases but low
    # overall viewership — high favourites, lower popularity and score ranks.
    print("Pass 3/5: Year-by-year (favourites sort)...")
    added = 0
    for year in tqdm(range(1960, current_year + 1), desc="  Years"):
        results = fetch_paginated(
            YEAR_QUERY,
            lambda p, y=year: {"page": p, "year": y, "sort": ["FAVOURITES_DESC"]},
        )
        for anime in results:
            if anime["id"] not in all_anime:
                all_anime[anime["id"]] = anime
                added += 1
        time.sleep(0.3)

    print(f"  → +{added} new anime. Total: {len(all_anime)}\n")

    # ── Pass 4: No-year gap fill with 7 sort orders ──────────────────────────
    # Some anime in AniList have no seasonYear set (incomplete metadata).
    # These were invisible to the year loop. We now run 7 different sort
    # orders with no year filter to surface as many of these as possible.
    gap_sorts = [
        ("POPULARITY_DESC",  "popularity descending"),
        ("SCORE_DESC",       "score descending"),
        ("FAVOURITES_DESC",  "favourites descending"),
        ("START_DATE",       "start date ascending (oldest first)"),
        ("START_DATE_DESC",  "start date descending (newest first)"),
        ("ID",               "ID ascending"),
        ("ID_DESC",          "ID descending"),
    ]

    print("Pass 4/5: No-year gap fill (7 sort orders)...")
    for sort_val, sort_label in gap_sorts:
        results = fetch_paginated(
            NOYEAR_QUERY,
            lambda p, s=sort_val: {"page": p, "sort": [s]},
        )
        added = sum(1 for a in results if a["id"] not in all_anime)
        for anime in results:
            if anime["id"] not in all_anime:
                all_anime[anime["id"]] = anime
        print(f"  {sort_label}: +{added} new anime")
        time.sleep(1.0)

    print(f"  → Total after pass 4: {len(all_anime)}\n")

    # ── Pass 5: Status sweep ─────────────────────────────────────────────────
    # Final safety net. Fetches every anime grouped by status regardless of
    # year or sort order.
    statuses = [
        ("RELEASING",        "currently airing"),
        ("FINISHED",         "finished airing"),
        ("NOT_YET_RELEASED", "not yet released"),
        ("CANCELLED",        "cancelled"),
        ("HIATUS",           "on hiatus"),
    ]

    print("Pass 5/5: Status sweep...")
    for status_val, status_label in statuses:
        results = fetch_paginated(
            STATUS_QUERY,
            lambda p, s=status_val: {"page": p, "status": s},
        )
        added = sum(1 for a in results if a["id"] not in all_anime)
        for anime in results:
            if anime["id"] not in all_anime:
                all_anime[anime["id"]] = anime
        print(f"  {status_label}: +{added} new anime")
        time.sleep(1.0)

    print(f"\n✓ All passes complete. Final total: {len(all_anime)} unique anime.")
    return list(all_anime.values())

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)

    anime_list = fetch_all_anime()

    with open("data/anilist_raw.json", "w") as f:
        json.dump(anime_list, f, indent=2)

    print(f"Saved {len(anime_list)} anime to data/anilist_raw.json")
```

Run it:
```
python3 fetch_anilist.py
```

You will see progress bars for each pass and running totals so you always know where it is. The full run takes about 60–90 minutes. When it finishes you will have `data/anilist_raw.json` with the complete AniList catalogue.

---

## Step 6 — Fetch reviews from AniList

Reviews are fetched separately because most anime have few or none — fetching them in the main query would slow everything down. This script only fetches reviews for popular anime that are likely to have them.

Create a file called `fetch_reviews.py`:

```python
import requests
import json
import time
import os
from tqdm import tqdm

ANILIST_URL = "https://graphql.anilist.co"

REVIEWS_QUERY = """
query ($mediaId: Int, $page: Int) {
  Page(page: $page, perPage: 20) {
    pageInfo { hasNextPage }
    reviews(mediaId: $mediaId, sort: RATING_DESC) {
      score
      summary
      body(asHtml: false)
      rating
      ratingAmount
    }
  }
}
"""

def fetch_reviews_for_anime(anilist_id, retries=5):
    reviews = []
    page = 1

    while True:
        for attempt in range(retries):
            try:
                response = requests.post(
                    ANILIST_URL,
                    json={"query": REVIEWS_QUERY, "variables": {"mediaId": anilist_id, "page": page}},
                    headers={"Content-Type": "application/json"},
                    timeout=30
                )

                if response.status_code == 429:
                    time.sleep(60)
                    continue

                if response.status_code != 200:
                    time.sleep(5)
                    continue

                data = response.json()

                # Guard against null data or null Page from AniList
                raw_data = data.get("data") or {}
                page_data = raw_data.get("Page") or {}
                page_reviews = page_data.get("reviews") or []
                has_next = (page_data.get("pageInfo") or {}).get("hasNextPage", False)

                reviews.extend(page_reviews)

                if not has_next or len(reviews) >= 40:
                    return reviews

                page += 1
                time.sleep(0.6)
                break  # success — exit retry loop and fetch next page

            except Exception as e:
                if attempt < retries - 1:
                    time.sleep(5)
                else:
                    # All retries failed — return whatever we have so far
                    return reviews

    return reviews

def fetch_all_reviews():
    with open("data/anilist_raw.json") as f:
        anime_list = json.load(f)

    popular = [a for a in anime_list if (a.get("popularity") or 0) >= 1000]
    print(f"Fetching reviews for {len(popular)} popular anime")

    cache_file = "data/reviews.json"
    reviews_by_id = {}
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            reviews_by_id = json.load(f)
        print(f"Loaded {len(reviews_by_id)} cached entries")

    to_fetch = [a for a in popular if str(a["id"]) not in reviews_by_id]

    for anime in tqdm(to_fetch, desc="Fetching reviews"):
        anilist_id = anime["id"]
        reviews = fetch_reviews_for_anime(anilist_id)
        reviews_by_id[str(anilist_id)] = reviews

        # Save every 100 entries so crashes lose minimal progress
        if len(reviews_by_id) % 100 == 0:
            with open(cache_file, "w") as f:
                json.dump(reviews_by_id, f)

        time.sleep(0.6)

    with open(cache_file, "w") as f:
        json.dump(reviews_by_id, f, indent=2)

    has_reviews = sum(1 for r in reviews_by_id.values() if r)
    total_reviews = sum(len(r) for r in reviews_by_id.values())
    print(f"\nDone. {has_reviews} anime have at least one review.")
    print(f"Total reviews collected: {total_reviews}")

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    fetch_all_reviews()
```

Run it:
```
python3 fetch_reviews.py
```

This takes about 45 minutes. It saves progress as it goes so if it stops you can run it again and it picks up where it left off.

---

## Step 7 — Register with AniDB and fetch their data

AniDB has much richer tag data than AniList — each tag has a community-voted weight (0–600) showing how strongly it applies to a show. It also has episode descriptions and reviews.

### 7.1 Create an AniDB account

Go to https://anidb.net and create a free account. Confirm your email if they send a verification message.

### 7.2 Register your project

AniDB requires you to register any app or script that uses their API. This is a two-step process: first you create a Project, then you add a Client to it.

**Part A — Create the project:**

1. Go to https://anidb.net/software/add (log in if prompted)
2. Fill in the form:
   - **Project Name:** `nextarcpipeline`
   - **Type:** Commandline Script
   - **State:** in development
   - **Public Project?:** no, private only
   - **Target OS:** Mac
   - **Language:** Python
   - **Contact:** your email address
   - **Description:** Personal pipeline to fetch anime data for a recommendation app
3. Click **+ Add Project**

**Part B — Add a client:**

After submitting you will land on your project page. You will see a yellow warning that says "You haven't added a client for this project yet."

1. Click **Add Client** in the top right corner
2. Fill in the form:
   - **Client Name:** `nextarcpipeline`
   - **API:** HTTP API
   - **Version:** 1
3. Click **+ Add Client**

Your client name is `nextarcpipeline` and your version is `1`. These go into your `.env` file in Step 7.4.

**Important:** AniDB client names must be lowercase letters and numbers only — no underscores, no spaces, no special characters.

### 7.3 Download the AniDB titles dump

AniDB provides a file listing every anime ID in their database. You need this to know which IDs to fetch.

1. In your browser, go to: http://anidb.net/api/anime-titles.xml.gz
2. The file will download to your Downloads folder
3. In Finder, go to Downloads and find the file `anime-titles.xml.gz`
4. Double-click it — Mac will extract it automatically and create `anime-titles.xml` next to it
5. Move `anime-titles.xml` into the `data` folder inside your `nextarc-pipeline` folder on the Desktop

To move it using Terminal:
```
mv ~/Downloads/anime-titles.xml ~/Desktop/nextarc-pipeline/data/anime-titles.xml
```

Verify it is in the right place:
```
ls ~/Desktop/nextarc-pipeline/data/
```

You should see `anime-titles.xml` in the list.

### 7.4 Add AniDB credentials to your .env file

Run these two commands one at a time:

```
echo "ANIDB_CLIENT=nextarcpipeline" >> .env
```

```
echo "ANIDB_CLIENTVER=1" >> .env
```

The `>>` adds to the existing file rather than replacing it.

Verify the file now has all four lines:
```
cat .env
```

You should see:
```
FIREBASE_KEY_PATH=firebase-key.json
FIREBASE_PROJECT_ID=your-actual-project-id
ANIDB_CLIENT=nextarcpipeline
ANIDB_CLIENTVER=1
```

### 7.5 Create the AniDB fetch script

Create a file called `fetch_anidb.py`:

```python
import requests
import json
import time
import xml.etree.ElementTree as ET
import os
from tqdm import tqdm
from dotenv import load_dotenv

load_dotenv()

CLIENT = os.getenv("ANIDB_CLIENT")
CLIENTVER = os.getenv("ANIDB_CLIENTVER")
ANIDB_URL = "http://api.anidb.net:9001/httpapi"

def get_anidb_ids_from_dump(dump_path="data/anime-titles.xml"):
    tree = ET.parse(dump_path)
    root = tree.getroot()
    ids = []
    for anime in root.findall("anime"):
        aid = anime.get("aid")
        if aid:
            ids.append(int(aid))
    return ids

def fetch_anime_details(anidb_id):
    params = {
        "client": CLIENT,
        "clientver": CLIENTVER,
        "protover": "1",
        "request": "anime",
        "aid": anidb_id
    }
    response = requests.get(ANIDB_URL, params=params)
    if response.status_code != 200:
        return None
    return response.text

def parse_anidb_xml(xml_text):
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    if root.tag == "error":
        return None

    anime = {}
    anime["anidb_id"] = int(root.get("id", 0))

    for resource in root.findall(".//resource[@type='5']"):
        ext_id = resource.find("externalentity/identifier")
        if ext_id is not None:
            anime["mal_id"] = int(ext_id.text)
            break

    tags = []
    for tag in root.findall(".//tag"):
        name = tag.find("name")
        weight = tag.get("weight", "0")
        count = tag.get("count", "0")
        if name is not None and name.text:
            tags.append({
                "name": name.text.lower(),
                "weight": int(weight),
                "count": int(count)
            })
    anime["tags"] = tags

    desc = root.find("description")
    if desc is not None and desc.text:
        anime["description"] = desc.text

    eps = root.find("episodecount")
    if eps is not None and eps.text:
        anime["episode_count"] = int(eps.text)

    reviews = []
    for review in root.findall(".//review"):
        text_el = review.find("text")
        votes_el = review.find("votes")
        rating_el = review.find("rating")
        if text_el is not None and text_el.text and len(text_el.text) > 100:
            reviews.append({
                "text": text_el.text.strip(),
                "votes": int(votes_el.text) if votes_el is not None and votes_el.text else 0,
                "rating": float(rating_el.text) if rating_el is not None and rating_el.text else None
            })
    anime["reviews"] = sorted(reviews, key=lambda r: r["votes"], reverse=True)

    episode_descriptions = []
    for ep in root.findall(".//episode"):
        ep_type = ep.find("epno")
        if ep_type is not None and ep_type.get("type") == "1":
            summary = ep.find("summary")
            if summary is not None and summary.text and len(summary.text.strip()) > 20:
                episode_descriptions.append(summary.text.strip())
    anime["episode_descriptions"] = episode_descriptions

    CONTENT_WARNING_KEYWORDS = {
        "violence", "gore", "blood", "death", "suicide", "rape", "sexual content",
        "nudity", "ecchi", "hentai", "abuse", "torture", "drug use", "alcohol",
        "smoking", "body horror", "psychological abuse", "sexual abuse", "child abuse"
    }
    content_warnings = []
    for tag in anime.get("tags", []):
        name = tag["name"].lower()
        if any(kw in name for kw in CONTENT_WARNING_KEYWORDS) and tag["weight"] >= 200:
            content_warnings.append({"tag": tag["name"], "weight": tag["weight"]})
    anime["content_warnings"] = sorted(content_warnings, key=lambda t: t["weight"], reverse=True)

    return anime

def fetch_all_anidb():
    ids = get_anidb_ids_from_dump()
    print(f"Found {len(ids)} AniDB IDs in dump")

    results = {}
    os.makedirs("data/anidb_cache", exist_ok=True)

    cache_file = "data/anidb_results.json"
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            results = json.load(f)
        print(f"Loaded {len(results)} cached entries")

    ids_to_fetch = [i for i in ids if str(i) not in results]

    for anidb_id in tqdm(ids_to_fetch, desc="Fetching AniDB"):
        xml = fetch_anime_details(anidb_id)
        if xml:
            parsed = parse_anidb_xml(xml)
            if parsed:
                results[str(anidb_id)] = parsed

        if len(results) % 100 == 0:
            with open(cache_file, "w") as f:
                json.dump(results, f)

        time.sleep(2.1)

    with open(cache_file, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nSaved {len(results)} AniDB entries")
    return results

if __name__ == "__main__":
    fetch_all_anidb()
```

Run it — use `caffeinate` so your Mac stays awake the whole time:
```
caffeinate -i python3 fetch_anidb.py
```

**This takes about 10 hours** because AniDB only allows 1 request every 2 seconds. Run it overnight. If it gets interrupted for any reason, just run the same command again — it saves progress every 100 entries and will pick up where it left off.

---

## Step 8 — Merge all data

This script combines the AniList and AniDB data into one unified record per anime, using the MAL ID as the common key between both databases.

Create a file called `merge_data.py`:

```python
import json
import os

def normalize_anidb_tags(anidb_tags, min_weight=100):
    MAX_WEIGHT = 600
    result = {}
    for tag in anidb_tags:
        if tag["weight"] >= min_weight:
            result[tag["name"]] = round(tag["weight"] / MAX_WEIGHT, 3)
    return result

def normalize_anilist_tags(anilist_tags):
    result = {}
    for tag in anilist_tags:
        if not tag.get("isMediaSpoiler", False):
            result[tag["name"].lower()] = round(tag["rank"] / 100, 3)
    return result

def merge_tag_vectors(anidb_vector, anilist_vector):
    merged = {}
    for tag, score in anilist_vector.items():
        merged[tag] = {"score": score, "source": "anilist"}
    for tag, score in anidb_vector.items():
        if tag in merged:
            blended = round(score * 0.7 + merged[tag]["score"] * 0.3, 3)
            merged[tag] = {"score": blended, "source": "merged"}
        else:
            merged[tag] = {"score": score, "source": "anidb"}
    return merged

def build_relation_graph(anilist_relations):
    graph = []
    for edge in anilist_relations.get("edges", []):
        node = edge.get("node", {})
        if node.get("type") == "ANIME":
            graph.append({
                "mal_id": node.get("idMal"),
                "anilist_id": node.get("id"),
                "relation": edge.get("relationType")
            })
    return graph

def build_staff_list(anilist_staff):
    staff = []
    priority_roles = {
        "Director", "Series Director", "Series Composition",
        "Script", "Music", "Character Design", "Original Creator"
    }
    for edge in (anilist_staff or {}).get("edges", []):
        role = edge.get("role", "")
        node = edge.get("node", {})
        name = (node.get("name") or {}).get("full", "")
        if name and any(r.lower() in role.lower() for r in priority_roles):
            staff.append({"id": node.get("id"), "name": name, "role": role})
    return staff

def build_recommendations_graph(anilist_recs):
    recs = []
    for node in (anilist_recs or {}).get("nodes", []):
        rating = node.get("rating", 0) or 0
        media = node.get("mediaRecommendation") or {}
        if rating > 0 and media.get("id"):
            recs.append({
                "anilist_id": media.get("id"),
                "mal_id": media.get("idMal"),
                "community_rating": rating
            })
    return sorted(recs, key=lambda r: r["community_rating"], reverse=True)

def merge_datasets():
    print("Loading AniList data...")
    with open("data/anilist_raw.json") as f:
        anilist_list = json.load(f)

    print("Loading AniDB data...")
    with open("data/anidb_results.json") as f:
        anidb_by_id = json.load(f)

    print("Loading reviews...")
    reviews_by_id = {}
    if os.path.exists("data/reviews.json"):
        with open("data/reviews.json") as f:
            reviews_by_id = json.load(f)
        print(f"  Loaded reviews for {len(reviews_by_id)} anime")

    anidb_by_mal = {}
    for anidb_id, record in anidb_by_id.items():
        mal_id = record.get("mal_id")
        if mal_id:
            anidb_by_mal[mal_id] = record

    print(f"AniList: {len(anilist_list)} anime")
    print(f"AniDB with MAL IDs: {len(anidb_by_mal)} anime")

    merged = {}
    anidb_match_count = 0

    for anime in anilist_list:
        mal_id = anime.get("idMal")
        anilist_id = anime.get("id")
        if not anilist_id:
            continue

        anidb_record = anidb_by_mal.get(mal_id) if mal_id else None
        if anidb_record:
            anidb_match_count += 1

        anidb_tags = normalize_anidb_tags(anidb_record.get("tags", [])) if anidb_record else {}
        anilist_tags = normalize_anilist_tags(anime.get("tags", []))

        if len(anidb_tags) >= 5:
            tag_source = "anidb" if not anilist_tags else "merged"
        elif anilist_tags:
            tag_source = "anilist"
        else:
            tag_source = "none"

        tag_vector = merge_tag_vectors(anidb_tags, anilist_tags)
        flat_tags = {tag: data["score"] for tag, data in tag_vector.items()}

        raw_anilist_reviews = reviews_by_id.get(str(anilist_id), [])
        def anilist_review_score(r):
            total = r.get("ratingAmount") or 1
            return (r.get("rating") or 0) / total
        sorted_anilist = sorted(raw_anilist_reviews, key=anilist_review_score, reverse=True)
        anidb_reviews = (anidb_record or {}).get("reviews", [])

        review_texts = []
        review_scores = []
        for r in sorted_anilist[:8]:
            body = r.get("body") or r.get("summary") or ""
            if body and len(body) > 50:
                review_texts.append(body)
                if r.get("score") is not None:
                    review_scores.append(r["score"])
        for r in anidb_reviews[:5]:
            text = r.get("text", "")
            if text and len(text) > 100:
                review_texts.append(text)
                if r.get("rating") is not None:
                    review_scores.append(r["rating"] * 10)

        record = {
            "anilist_id": anilist_id,
            "mal_id": mal_id,
            "anidb_id": anidb_record.get("anidb_id") if anidb_record else None,
            "title": (anime.get("title") or {}).get("english") or (anime.get("title") or {}).get("romaji", ""),
            "title_romaji": (anime.get("title") or {}).get("romaji", ""),
            "description": anime.get("description") or (anidb_record or {}).get("description", ""),
            "review_texts": review_texts,
            "review_score_avg": round(sum(review_scores) / len(review_scores), 1) if review_scores else None,
            "review_count": len(review_texts),
            "review_count_anilist": len([r for r in sorted_anilist[:8] if (r.get("body") or r.get("summary") or "")]),
            "review_count_anidb": len([r for r in anidb_reviews[:5] if r.get("text", "")]),
            "genres": anime.get("genres", []),
            "source": anime.get("source"),
            "format": anime.get("format"),
            "duration": anime.get("duration"),
            "tag_vector": flat_tags,
            "tag_source": tag_source,
            "content_warnings": (anidb_record or {}).get("content_warnings", []),
            "score_anilist": anime.get("averageScore"),
            "popularity": anime.get("popularity", 0),
            "episodes": anime.get("episodes") or (anidb_record or {}).get("episode_count"),
            "episode_descriptions": (anidb_record or {}).get("episode_descriptions", []),
            "status": anime.get("status"),
            "season": anime.get("season"),
            "season_year": anime.get("seasonYear"),
            "studios": [s["name"] for s in (anime.get("studios") or {}).get("nodes", [])],
            "staff": build_staff_list(anime.get("staff")),
            "relations": build_relation_graph(anime.get("relations") or {}),
            "similar_titles": build_recommendations_graph(anime.get("recommendations")),
            "tfidf_keywords": [],
            "lda_topics": [],
            "embedding": [],
            "sentiment_score": None,
            "coverage": 0.0
        }

        coverage_fields = [
            bool(flat_tags),
            bool(record["description"]),
            bool(record["score_anilist"]),
            bool(record["episodes"]),
            len(flat_tags) >= 5,
            tag_source in ("anidb", "merged"),
            len(review_texts) >= 1,
            len(review_texts) >= 3,
            record["review_count_anidb"] >= 1,
            record["review_count_anilist"] >= 1,
            bool(record["staff"]),
            bool(record["similar_titles"]),
            bool((anidb_record or {}).get("episode_descriptions")),
            bool(record["source"]),
        ]
        record["coverage"] = round(sum(coverage_fields) / len(coverage_fields), 2)

        merged[str(anilist_id)] = record

    print(f"\nMerged {len(merged)} total anime")
    print(f"AniDB match rate: {anidb_match_count}/{len(anilist_list)} ({round(anidb_match_count/len(anilist_list)*100)}%)")

    os.makedirs("data", exist_ok=True)
    with open("data/merged.json", "w") as f:
        json.dump(merged, f, indent=2)

    print("Saved to data/merged.json")

if __name__ == "__main__":
    merge_datasets()
```

Run it:
```
python3 merge_data.py
```

Takes about 30 seconds. Produces `data/merged.json`.

---

## Step 9 — Run NLP processing

This script runs four NLP passes over all the text (synopsis + episode descriptions + reviews):

- **TF-IDF** — finds the most distinctive keywords for each anime
- **LDA** — finds 40 hidden topics across the whole catalogue (e.g. "psychological thriller", "slice of life romance")
- **Sentence embeddings** — converts each anime's text into a 384-number vector; similar shows end up with similar vectors
- **Sentiment analysis** — scores how positively or negatively reviewers received each show

Create a file called `process_nlp.py`:

```python
import json
import os
import re
import pickle
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.decomposition import LatentDirichletAllocation
from sentence_transformers import SentenceTransformer
from transformers import pipeline
from tqdm import tqdm

def clean_text(text):
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def get_combined_text(anime):
    parts = []
    desc = clean_text(anime.get("description", ""))
    if desc:
        parts.append(desc)
    for ep_desc in anime.get("episode_descriptions", []):
        cleaned = clean_text(ep_desc)
        if cleaned:
            parts.append(cleaned)
    for review in anime.get("review_texts", []):
        cleaned = clean_text(review)
        if cleaned:
            parts.append(cleaned)
    return " ".join(parts)

def run_tfidf(anime_list, top_n=15):
    print("Running TF-IDF...")
    texts = [get_combined_text(a) for a in anime_list]
    vectorizer = TfidfVectorizer(
        max_features=10000,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=2
    )
    tfidf_matrix = vectorizer.fit_transform(texts)
    feature_names = vectorizer.get_feature_names_out()
    keywords_per_anime = []
    for i in range(tfidf_matrix.shape[0]):
        row = tfidf_matrix.getrow(i).toarray()[0]
        top_indices = row.argsort()[-top_n:][::-1]
        keywords = [
            {"word": feature_names[idx], "score": round(float(row[idx]), 4)}
            for idx in top_indices if row[idx] > 0
        ]
        keywords_per_anime.append(keywords)
    return keywords_per_anime

def run_lda(anime_list, num_topics=40):
    print(f"Running LDA with {num_topics} topics...")
    texts = [get_combined_text(a) for a in anime_list]
    count_vectorizer = CountVectorizer(
        max_features=10000,
        stop_words="english",
        min_df=2
    )
    count_matrix = count_vectorizer.fit_transform(texts)
    feature_names = count_vectorizer.get_feature_names_out()
    lda_model = LatentDirichletAllocation(
        n_components=num_topics,
        random_state=42,
        max_iter=10,
        n_jobs=-1
    )
    topic_matrix = lda_model.fit_transform(count_matrix)
    os.makedirs("data/models", exist_ok=True)
    with open("data/models/lda_model.pkl", "wb") as f:
        pickle.dump(lda_model, f)
    with open("data/models/lda_vectorizer.pkl", "wb") as f:
        pickle.dump(count_vectorizer, f)
    print("\nLDA Topics (top words):")
    for idx, topic in enumerate(lda_model.components_):
        top_words = [feature_names[i] for i in topic.argsort()[-6:][::-1]]
        print(f"  Topic {idx:02d}: {', '.join(top_words)}")
    return [[round(float(v), 4) for v in row] for row in topic_matrix]

def run_embeddings(anime_list, batch_size=64):
    print("Generating sentence embeddings...")
    print("(Downloading model on first run — about 90MB)")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts_flat = []
    indices = []
    for i, anime in enumerate(anime_list):
        desc = clean_text(anime.get("description", "")) or anime.get("title", "")
        texts_flat.append(desc)
        indices.append(i)
        for review in anime.get("review_texts", [])[:5]:
            cleaned = clean_text(review)
            if cleaned:
                texts_flat.append(cleaned)
                indices.append(i)
    print(f"  Embedding {len(texts_flat)} texts...")
    embeddings_flat = []
    for i in tqdm(range(0, len(texts_flat), batch_size), desc="Embedding"):
        batch = texts_flat[i:i+batch_size]
        emb = model.encode(batch, convert_to_numpy=True)
        embeddings_flat.extend(emb.tolist())
    from collections import defaultdict
    anime_embs = defaultdict(list)
    for emb, anime_idx in zip(embeddings_flat, indices):
        anime_embs[anime_idx].append(emb)
    all_embeddings = []
    for i in range(len(anime_list)):
        embs = anime_embs[i]
        if embs:
            avg = np.mean(embs, axis=0).tolist()
            all_embeddings.append([round(v, 5) for v in avg])
        else:
            all_embeddings.append([])
    return all_embeddings

def run_sentiment(anime_list):
    print("Running sentiment analysis on reviews...")
    print("(Downloading sentiment model on first run — about 250MB)")
    sentiment_pipe = pipeline(
        "sentiment-analysis",
        model="distilbert-base-uncased-finetuned-sst-2-english",
        truncation=True,
        max_length=512
    )
    results = []
    for anime in tqdm(anime_list, desc="Sentiment"):
        reviews = anime.get("review_texts", [])
        if not reviews:
            results.append(None)
            continue
        truncated = [clean_text(r)[:400] for r in reviews[:8] if r]
        if not truncated:
            results.append(None)
            continue
        scores = []
        for text in truncated:
            try:
                result = sentiment_pipe(text)[0]
                score = result["score"] if result["label"] == "POSITIVE" else -result["score"]
                scores.append(score)
            except Exception:
                continue
        results.append(round(sum(scores) / len(scores), 3) if scores else None)
    return results

def process_all():
    print("Loading merged data...")
    with open("data/merged.json") as f:
        merged = json.load(f)
    ids = list(merged.keys())
    anime_list = [merged[i] for i in ids]
    print(f"Processing {len(anime_list)} anime...\n")

    tfidf_results = run_tfidf(anime_list)
    lda_results = run_lda(anime_list)
    embedding_results = run_embeddings(anime_list)
    sentiment_results = run_sentiment(anime_list)

    for i, anilist_id in enumerate(ids):
        merged[anilist_id]["tfidf_keywords"] = tfidf_results[i]
        merged[anilist_id]["lda_topics"] = lda_results[i]
        merged[anilist_id]["embedding"] = embedding_results[i]
        merged[anilist_id]["sentiment_score"] = sentiment_results[i]
        merged[anilist_id].pop("review_texts", None)
        merged[anilist_id].pop("episode_descriptions", None)

    with open("data/processed.json", "w") as f:
        json.dump(merged, f, indent=2)

    print(f"\nDone. Saved to data/processed.json")
    print(f"File size: {round(os.path.getsize('data/processed.json') / 1024 / 1024, 1)} MB")

if __name__ == "__main__":
    process_all()
```

Run it:
```
python3 process_nlp.py
```

Takes 20–30 minutes. The first run downloads two models (~340MB total) — that is normal.

---

## Step 10 — Upload to Firebase

This script reads your processed data and writes it to your Firestore database, one record per anime.

Create a file called `upload_to_firebase.py`:

```python
import json
import os
from tqdm import tqdm
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

def upload():
    cred = credentials.Certificate(os.getenv("FIREBASE_KEY_PATH"))
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print("Loading processed data...")
    with open("data/processed.json") as f:
        processed = json.load(f)

    anime_list = list(processed.values())
    print(f"Uploading {len(anime_list)} anime to Firestore...")

    BATCH_SIZE = 400
    anime_ref = db.collection("anime")

    for batch_start in tqdm(range(0, len(anime_list), BATCH_SIZE), desc="Uploading"):
        batch = db.batch()
        chunk = anime_list[batch_start:batch_start + BATCH_SIZE]
        for anime in chunk:
            anilist_id = str(anime["anilist_id"])
            doc_ref = anime_ref.document(anilist_id)
            batch.set(doc_ref, anime, merge=True)
        batch.commit()

    print(f"\nUpload complete. {len(anime_list)} documents in Firestore.")

if __name__ == "__main__":
    upload()
```

Run it:
```
python3 upload_to_firebase.py
```

Takes about 10 minutes.

---

## Step 11 — Deploy the Cloud Function

The Cloud Function runs inside Firebase and automatically recomputes recommendations whenever a user rates an anime.

### 11.1 Install Firebase CLI

The Firebase CLI is a tool that lets you deploy code to Firebase from Terminal.

```
npm install -g firebase-tools
```

If you see a permissions error, run:
```
sudo npm install -g firebase-tools
```
It will ask for your Mac password — type it and press Enter (you will not see it as you type, that is normal).

### 11.2 Log in to Firebase

```
firebase login
```

This opens a browser window. Log in with the same Google account you use for Firebase. Come back to Terminal when it says you are logged in.

### 11.3 Initialize Firebase Functions

Make sure you are in your `nextarc-pipeline` folder first:
```
cd ~/Desktop/nextarc-pipeline
```

Then run:
```
firebase init functions
```

When it asks questions:
- **Which Firebase project?** → Use the arrow keys to select your existing Next Arc project, then press Enter
- **Language?** → Select **JavaScript** with arrow keys, press Enter
- **ESLint?** → Type `n` and press Enter
- **Install dependencies now?** → Type `y` and press Enter

Wait for it to finish.

### 11.4 Create the function

A file called `functions/index.js` was just created inside your `nextarc-pipeline` folder. You need to replace everything in it.

To open it: open Finder → go to Desktop → `nextarc-pipeline` → `functions` → right-click `index.js` → **Open With → TextEdit**.

Select all the text (Cmd + A), delete it, and paste this:

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildTasteVector(ratings) {
  const animeIds = Object.keys(ratings);
  if (animeIds.length === 0) return null;

  const tagScores = {};
  const embeddingSum = new Array(384).fill(0);
  let embeddingCount = 0;
  const staffScores = {};
  const sourceScores = {};
  const formatScores = {};
  const collaborativeBoosts = new Set();

  for (const anilistId of animeIds) {
    const rating = ratings[anilistId];
    if (rating === "skip") continue;

    const weight = rating === "supergood" ? 2.0
                 : rating === "like"      ? 1.0
                 : -1.0;

    const snap = await db.collection("anime").doc(anilistId).get();
    if (!snap.exists) continue;
    const data = snap.data();

    const tags = data.tag_vector || {};
    for (const [tag, score] of Object.entries(tags)) {
      tagScores[tag] = (tagScores[tag] || 0) + score * weight;
    }

    const emb = data.embedding || [];
    if (emb.length === 384) {
      for (let i = 0; i < 384; i++) embeddingSum[i] += emb[i] * weight;
      embeddingCount++;
    }

    if (weight > 0) {
      for (const s of (data.staff || [])) {
        if (s.id) staffScores[s.id] = (staffScores[s.id] || 0) + weight;
      }
      if (data.source) sourceScores[data.source] = (sourceScores[data.source] || 0) + weight;
      if (data.format) formatScores[data.format] = (formatScores[data.format] || 0) + weight;
      for (const rec of (data.similar_titles || [])) {
        if (rec.anilist_id) collaborativeBoosts.add(String(rec.anilist_id));
      }
    }
  }

  const embedding = embeddingCount > 0
    ? embeddingSum.map(v => v / embeddingCount)
    : null;

  return { tagScores, embedding, staffScores, sourceScores, formatScores, collaborativeBoosts };
}

function scoreCandidate(anime, tasteVector, seenIds) {
  if (seenIds.has(String(anime.anilist_id))) return -1;

  let score = 0;

  const tags = anime.tag_vector || {};
  for (const [tag, tagScore] of Object.entries(tags)) {
    if (tasteVector.tagScores[tag]) score += tagScore * tasteVector.tagScores[tag] * 0.5;
  }

  if (tasteVector.embedding && anime.embedding && anime.embedding.length === 384) {
    score += cosineSimilarity(tasteVector.embedding, anime.embedding) * 0.25;
  }

  let staffBoost = 0;
  for (const s of (anime.staff || [])) {
    if (s.id && tasteVector.staffScores[s.id]) staffBoost += tasteVector.staffScores[s.id];
  }
  if (staffBoost > 0) score += Math.min(staffBoost / 3, 1.0) * 0.1;

  if (tasteVector.collaborativeBoosts.has(String(anime.anilist_id))) score += 0.1;

  let prefBoost = 0;
  const sourceTotal = Object.values(tasteVector.sourceScores).reduce((a, b) => a + b, 0);
  if (anime.source && tasteVector.sourceScores[anime.source] && sourceTotal > 0)
    prefBoost += (tasteVector.sourceScores[anime.source] / sourceTotal) * 0.5;
  const formatTotal = Object.values(tasteVector.formatScores).reduce((a, b) => a + b, 0);
  if (anime.format && tasteVector.formatScores[anime.format] && formatTotal > 0)
    prefBoost += (tasteVector.formatScores[anime.format] / formatTotal) * 0.5;
  score += prefBoost * 0.05;

  return score;
}

exports.recomputeRecs = functions.firestore
  .document("users/{userId}/profile/ratings")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const ratings = change.after.exists ? change.after.data() : {};

    const tasteVector = await buildTasteVector(ratings);
    if (!tasteVector) return;

    const seenIds = new Set(Object.keys(ratings));
    const snapshot = await db.collection("anime").get();
    const candidates = snapshot.docs.map(d => d.data());

    const scored = candidates
      .map(anime => ({ anime, score: scoreCandidate(anime, tasteVector, seenIds) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    const recs = scored.map(({ anime, score }) => ({
      anilist_id: anime.anilist_id,
      mal_id: anime.mal_id,
      title: anime.title,
      score: Math.round(score * 1000) / 1000
    }));

    await db.collection("users").doc(userId)
      .collection("profile").doc("recommendations")
      .set({ recs, computed_at: admin.firestore.FieldValue.serverTimestamp() });
  });
```

Save the file (Cmd + S) and close TextEdit.

### 11.5 Deploy

```
firebase deploy --only functions
```

---

## Running order summary

Run these scripts in order from your `nextarc-pipeline` folder. You only need to do this once, then refresh monthly.

First make sure you are in the right folder:
```
cd ~/Desktop/nextarc-pipeline
```

Then run each script in order:

```
python3 fetch_anilist.py
```
Wait for it to finish (~60–90 min), then:

```
python3 fetch_reviews.py
```
Wait for it to finish (~45 min), then run the AniDB fetch overnight:

```
caffeinate -i python3 fetch_anidb.py
```
Wait for it to finish (~10 hours), then:

```
python3 merge_data.py
```

```
python3 process_nlp.py
```

```
python3 upload_to_firebase.py
```

```
firebase deploy --only functions
```

---

## What each file produces

| Script | Output file | What's inside | Approx size |
|---|---|---|---|
| fetch_anilist.py | data/anilist_raw.json | Tags, scores, staff, recommendations | ~25 MB |
| fetch_reviews.py | data/reviews.json | AniList reviews | ~80 MB |
| fetch_anidb.py | data/anidb_results.json | Weighted tags, episode descriptions, reviews | ~150 MB |
| merge_data.py | data/merged.json | Everything combined | ~200 MB |
| process_nlp.py | data/processed.json | + keywords, topics, embeddings, sentiment | ~250 MB |
| upload_to_firebase.py | Firestore /anime | Final records in your database | ~150 MB |

---

## If something goes wrong

**"command not found: python3"** — Python is not installed. Download it from https://python.org and install it, then try again.

**"No such file or directory"** — You are not in the right folder. Run `cd ~/Desktop/nextarc-pipeline` and try again.

**A script crashes partway through** — Every script saves its progress. Just run it again with the same command and it will pick up where it left off.

**"client banned" from AniDB** — Your client name or version does not match what you registered. Check your `.env` file with `cat .env` and make sure `ANIDB_CLIENT=nextarcpipeline` (no underscore) and `ANIDB_CLIENTVER=1`.

**Firebase upload fails** — Make sure `firebase-key.json` is in your `nextarc-pipeline` folder and your `.env` has the correct project ID.
