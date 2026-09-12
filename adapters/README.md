# Image generator adapters

The pipeline does not know which image model you use. It runs a command:

```
<command> --prompt-file <path> --out <path> [--ref <path>:<label>]... [--aspect <w:h>] [--model <name>]
```

Your adapter has to do one thing: **write an image to the path given in `--out`**.

| flag | meaning |
|---|---|
| `--prompt-file` | UTF-8 text file holding the entire prompt |
| `--out` | where to write the image. Create the directory if it is missing |
| `--ref` | a reference image and a short label, repeatable. **Order matters**: the first `--ref` is "Image 1" in the prompt text |
| `--aspect` | advisory, e.g. `2:1` for a panorama, `1:1` for an aerial |
| `--model` | only passed when `vstreat.config.json` names one |

Exit `0` means the file at `--out` exists and is readable. Anything else means
failure, and whatever you print on stderr is what the caller shows. Nothing on
stdout is part of the contract.

Exiting `0` without writing the file is the most common way an adapter is
wrong, and the caller says so in those words.

An adapter that cannot attach captions may ignore the `:label` half of `--ref`;
the order is what the prompt relies on.

## Choosing one

Copy `vstreat.config.example.json` to `vstreat.config.json` and point
`command` at your adapter. `VSTREAT_IMAGE_GEN` overrides it for one run.

## What ships here

- **`codex.sh`** — Codex's built-in `image_gen`. Every Codex-specific quirk is
  in that file, including the one where the wrapper ignores its own `--out`.
  Set `IMAGE_GEN` if the wrapper is not on your `PATH`.
- **`mock.sh`** — paints a wrapping gradient with a disc where the sun goes.
  It costs nothing, so use it to prove the plumbing before spending a real
  generation. It cannot stand in for the aerial photograph: a gradient traces
  into no roads and no buildings.

## Writing your own

Twenty lines of shell is usually enough. The job is to translate these flags
into whatever your tool wants, and to make sure the file lands at `--out`.
