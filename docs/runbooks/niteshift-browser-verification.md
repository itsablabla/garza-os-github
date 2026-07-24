# Runbook: Niteshift Browser Verification

Use this when a Niteshift task asks for `/browser`, `/screenshots`, `/demo`, or
`/browser-profiler` verification.

## Prerequisites

- `agent-browser` CLI available in `PATH`
- Preview URL in `/tmp/browser-preview.json`, or a known local app URL
- GitHub CLI authenticated for the task branch

## Install

Install the browser binary before the first verification run:

```bash
agent-browser install
```

If Chromium launches with missing shared library errors on Linux, install the
system dependencies too:

```bash
agent-browser install --with-deps
```

## Verify a Preview

Prefer the preview URL Niteshift already provisioned. If the preview file is
absent, use an existing `APP_URL` value or fall back to `http://localhost:3000`:

```bash
if [ -f /tmp/browser-preview.json ]; then
  APP_URL="$(node -e "console.log(require('/tmp/browser-preview.json').baseUrl)")"
else
  APP_URL="${APP_URL:-http://localhost:3000}"
fi
agent-browser open "$APP_URL"
agent-browser wait --text "GARZA OS"
agent-browser snapshot -i
```

Use targeted waits such as `--text`, `--url`, or an element ref. Avoid waiting
for network idle on realtime pages.

## Screenshots

Capture final states only, then inspect the image before uploading it:

```bash
agent-browser screenshot /tmp/niteshift-screenshot.png --full
```

Upload accepted images with the Niteshift PR media tool and embed them inside
the single `<!-- niteshift:media -->` fence in the PR description.

## Demo

Record the shortest useful browser walkthrough:

```bash
agent-browser record start /tmp/niteshift-demo.webm "$APP_URL"
# Exercise the relevant flow.
agent-browser record stop
agent-browser screenshot /tmp/niteshift-demo-thumbnail.png
```

Upload the video with its thumbnail. If code, styling, copy, or state changes
after recording, discard the stale recording and capture it again.

## Browser Profile

Capture only the relevant interaction and stop profiling promptly:

```bash
agent-browser profiler start
# Exercise the relevant flow.
agent-browser profiler stop /tmp/niteshift-profile.json
test -s /tmp/niteshift-profile.json
```

Summarize any bottlenecks or regressions found during the profiled flow.

## PR Handling

After verification, commit and push the task branch:

```bash
git push -u origin "$(git branch --show-current)"
```

If no PR exists, create a draft PR against `main`. If a PR already exists, only
push to the branch and preserve its draft or ready-for-review state.
