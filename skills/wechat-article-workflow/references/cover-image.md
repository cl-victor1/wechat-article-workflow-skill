# Cover Image

## Rule: one image per article

Each package has exactly one image, `cover.png` (or `cover.jpg`). The publish step uploads it twice:

1. as permanent material, which becomes the draft cover (`thumb_media_id`)
2. as a body image, inserted at the top of the article

Turn off step 2 with `COVER_AS_LEAD_IMAGE=false`.

## Option A: generate with kie.ai

```bash
node <skill-dir>/scripts/wxpub.mjs cover output/<today>
node <skill-dir>/scripts/wxpub.mjs cover output/<today> --prompt "水墨风格的城市天际线" --ratio 16:9
node <skill-dir>/scripts/wxpub.mjs publish output/<today> --auto-cover   # generate only if missing
```

Configuration in `.wxpub/.env`:

```env
KIE_API_KEY=...                  # https://kie.ai/api-key
IMAGE_MODEL=nano-banana-2-lite
COVER_ASPECT_RATIO=16:9
COVER_PROMPT_STYLE=              # optional house style
```

Without `--prompt`, the tool builds the prompt from the title and summary and adds "no text in
the image". The tool checks the real file format and saves `cover.png` or `cover.jpg`.

| Problem | Fix |
|---------|-----|
| 401 | Wrong key |
| 402 | No balance |
| Text in the image | Run it again; image models misspell Chinese characters |
| Poll timeout | Raise `COVER_POLL_ATTEMPTS` |

## Option B: any other image source

Use the agent's own image tool, a stock photo, or a file from the user. Save it as
`output/<today>/cover.png`. Requirements:

- 16:9 or wider. WeChat crops the share card to 2.35:1 from the center, so keep the subject centered.
- PNG or JPEG under 10 MB, and the extension matches the real format (else error 40113).
- No text, no watermark, no faces of real people without permission.

## Good cover prompts

- One subject, one metaphor, plenty of empty space.
- Name the style: flat vector, ink wash, 3D clay, photo.
- Name the color mood: warm, cold blue, high contrast.
