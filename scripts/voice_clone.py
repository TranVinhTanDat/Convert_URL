#!/usr/bin/env python3
"""Voice cloning via Coqui XTTS-v2 (CPU).

Clones the speaker in a reference WAV and synthesizes the given text in that
voice. Uses the multilingual XTTS-v2 model by default; pass --model-dir to use
a fine-tuned checkpoint (e.g. viXTTS for Vietnamese: needs model.pth, config.json,
vocab.json in that dir).

Usage:
   python voice_clone.py REF_WAV "text to speak" OUTPUT_WAV --lang en
   python voice_clone.py REF_WAV "xin chào"      OUTPUT_WAV --lang vi --model-dir DIR
"""
import argparse
import os
import sys

# Keep CPU threads reasonable so the box stays responsive.
os.environ.setdefault("OMP_NUM_THREADS", str(max(1, (os.cpu_count() or 4) // 2)))


def synth_with_api(ref, text, out, lang):
    """Default path: coqui TTS.api auto-downloads and runs XTTS-v2."""
    from TTS.api import TTS
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False).to("cpu")
    tts.tts_to_file(text=text, speaker_wav=ref, language=lang, file_path=out)


def _enable_vietnamese(tokenizer):
    """Base coqui XTTS tokenizer has no 'vi'. viXTTS needs a char limit + a Vietnamese
    text cleaner (the English number/abbrev/symbol expanders KeyError on 'vi')."""
    if "vi" not in tokenizer.char_limits:
        tokenizer.char_limits["vi"] = 250
    try:
        from vinorm import TTSnorm
        def vi_clean(t):
            return TTSnorm(t, unknown=False, lower=False, rule=True).strip()
    except Exception:
        import re
        def vi_clean(t):
            return re.sub(r"\s+", " ", t).strip()
    orig = tokenizer.preprocess_text
    def patched(txt, lang):
        return vi_clean(txt) if lang == "vi" else orig(txt, lang)
    tokenizer.preprocess_text = patched


def synth_with_checkpoint(ref, text, out, lang, model_dir):
    """Custom fine-tuned checkpoint (e.g. viXTTS) loaded via the low-level Xtts class."""
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    import soundfile as sf

    config = XttsConfig()
    config.load_json(os.path.join(model_dir, "config.json"))
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=model_dir, use_deepspeed=False)
    model.to("cpu")

    if lang == "vi":
        _enable_vietnamese(model.tokenizer)

    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=[ref])
    result = model.inference(text, lang, gpt_cond_latent, speaker_embedding,
                             temperature=0.7, enable_text_splitting=True)
    wav = result["wav"]
    sf.write(out, wav, 24000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ref")
    parser.add_argument("text")
    parser.add_argument("output")
    parser.add_argument("--lang", default="en")
    parser.add_argument("--model-dir", default="")
    args = parser.parse_args()

    if not os.path.exists(args.ref):
        print("ERROR: reference audio not found", file=sys.stderr)
        sys.exit(2)
    text = args.text.strip()
    if not text:
        print("ERROR: empty text", file=sys.stderr)
        sys.exit(2)

    try:
        if args.model_dir and os.path.isdir(args.model_dir):
            synth_with_checkpoint(args.ref, text, args.output, args.lang, args.model_dir)
        else:
            synth_with_api(args.ref, text, args.output, args.lang)
    except Exception as e:  # surface a clean message to the Node layer
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.output) or os.path.getsize(args.output) < 200:
        print("ERROR: synthesis produced no audio", file=sys.stderr)
        sys.exit(3)
    print(f"voice-clone ok lang={args.lang} -> {args.output}")


if __name__ == "__main__":
    main()
