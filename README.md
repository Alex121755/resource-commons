# Resource Commons

Resource Commons is a WAICY student project for finding and sharing supplies that a school already owns. Record an item and its last confirmed location, plan what an activity needs, or share selected resources with a private group.

**[Open the public workspace](https://alex121755.github.io/resource-commons/) · [Private groups](https://alex121755.github.io/resource-commons/groups.html) · [Teachers’ office case study](https://alex121755.github.io/resource-commons/teachers-office.html)**

## In a teachers’ office

The team has implemented Resource Commons for resource management in a teachers’ office. The case study illustrates how a teacher could record a spare whiteboard, list it for colleagues and arrange pickup. Actual office photographs are pending. The stock and demonstration photos in the workspace are credited teaching examples.

## Try it

1. Open **Inventory** to browse the sample collection, record an item or review a photo draft. Inventory and the simulated community, requests and messages are saved in the current browser.
2. Open **Groups**, choose a display name and save the personal member key in a password manager. Use that key to restore the profile in a different tab or device after signing out. Each member needs their own key.
3. Create a group and send a single-use invitation code privately to a colleague. In their own profile, the colleague can enter the code under **Join a group**. Codes expire after 24 hours. Issuing another code replaces the previous one.
4. Open the group, enter a resource or select one from your inventory, review the quantity and note, then choose **Share with this group**. Only members can retrieve group listings. The shared listing is a separate copy. Changes to a personal inventory record stay in that inventory.

Group listings persist in a server-side database. Members can remove their listings or leave a group, which also removes their listings. Owners can delete the group. A member key grants access to its holder; a display name is a label chosen by that member.

## Run locally

The hosted workspace supports manual entry, demonstration scenes and rule-based planning. To generate new AI drafts from your own photos or text, run the optional local Python service from the repository root with Python 3.10 or later.

```sh
RESOURCE_AI_BACKEND=local python3 -B outputs/local_ai/server.py
```

Open [the local workspace](http://127.0.0.1:8765/prototype/). For local inference, run Ollama with the configured model (the default is `qwen3.5:4b`), and set `RESOURCE_OLLAMA_URL` to your Ollama server if needed. To send recognition requests to OpenAI instead, configure `RESOURCE_AI_BACKEND=openai`, `OPENAI_API_KEY` and `RESOURCE_AI_MODEL` in the backend environment. Provider keys belong on the machine running the Python service.

## Deployment and tests

The public frontend is served by GitHub Pages from the `gh-pages` branch. That branch contains the contents of `outputs/prototype/` from the release on `main`. After pushing a release to `main`, run `git subtree push --prefix=outputs/prototype origin gh-pages` to publish the frontend. The Groups API is a separate Cloudflare Worker with a D1 database deployed through Sites. Its source and schema migrations are in `group-service/`. Membership checks run on the server for reads and writes. Photos, private inventory history, and AI credentials are excluded from group listings.

```sh
node --test outputs/prototype/*.test.js
# The group service tests use node:sqlite (Node.js 22.13 or later).
node --test group-service/test.mjs
RESOURCE_AI_BACKEND=local python3 -B -m unittest discover -s outputs/local_ai
```

Photo credits and licenses are listed in the [example photo manifest](outputs/prototype/assets/examples/sources.json) and [desk photo record](outputs/prototype/assets/demo/desk-source.json).
