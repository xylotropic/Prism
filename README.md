# Prism

Prism is a free, open-source dictation app for macOS. Hold the shortcut to dictate, watch new words appear in a virtual notch at the top of your display, and release to paste the finished text. Escape stops recording and skips the paste. Prism still transcribes what you said, counts the words, and saves the take according to your History settings. Click **Undo** in the cancellation notice to paste that take.

[Download Prism for Apple silicon](https://prism-dictation.vercel.app/Prism-Apple-Silicon.dmg)

![Prism’s black recording notch with a blue waveform and live transcript](docs/prism/notch.webp)

## See Prism in action

**Home** shows daily and total words, your streak, estimated time saved, and a calendar of your activity. The screenshot uses sample data.

![Prism’s Home page with sample activity and a blue usage calendar](docs/prism/home.webp)

**Models** lists what is installed, what supports Live preview, and what is downloading.

![Prism’s model picker with Parakeet selected and Qwen downloading](docs/prism/models.webp)

## Set up

1. Open the disk image, drag **Prism** into **Applications**, then open Prism from Applications. Grant Microphone and Accessibility access when prompted.
2. Download a streaming model during setup. For English, start with **Parakeet Unified English 0.6B**. For other languages, choose a compatible streaming model in Models. A batch-only model shows recording status during dictation and transcribes after release.
3. After setup, hold **Option–Space** in an editable field, speak, and release. Record a different shortcut in Settings.

Choose your notch accent and text animation in **Advanced**. Sweep and Cherenkov Blue are the defaults.

Choose another speech model in Models at any time. Prism downloads it if needed and activates it after any current dictation finishes.

Open Prism from the menu bar to switch downloaded models, select your language or microphone, or open History. Prism imports settings, downloaded models, and history from earlier builds on first launch.

The default workflow needs an internet connection to download the model once. Dictation then runs locally. The live preview holds partial words inside Prism and sends only the finalized text to the focused app. On a new installation, History keeps the 50 most recent takes and their audio by default. Change the retention setting in History at any time. Optional cloud text processing is off by default.

## Build on macOS

Install Xcode or its command line tools, a recent stable Rust toolchain, Bun, and CMake. From this repository, run:

```sh
bun install --frozen-lockfile
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build --bundles app
```

The app bundle is written to `src-tauri/target/release/bundle/macos/Prism.app`. See [BUILD.md](BUILD.md) for upstream build details. Preview builds use ad-hoc signing. macOS may ask for Microphone and Accessibility access again after installing a rebuilt preview. Launch the installed copy from Applications between updates.

For a public macOS release, use a **Developer ID Application** identity from the same Apple team for every update. With the certificate and its private key installed in Keychain, save the notarization credentials locally using `xcrun notarytool store-credentials prism-notary`. Then build the signed and notarized disk image with:

```sh
APPLE_SIGNING_IDENTITY='Developer ID Application: Your Team (TEAMID)' \
  bash scripts/package-prism-macos.sh /path/to/Prism-Apple-Silicon.dmg
```

## Source and licenses

Prism's app code is available under the [MIT license](LICENSE). Prism incorporates the local speech engine, keyboard handling, and paste pipeline from [Handy v0.10.1](https://github.com/cjpais/Handy).

Inter is distributed under the [SIL Open Font License](public/licenses/Inter.txt).

The recommended English model is pinned to a [CC BY 4.0 release](https://huggingface.co/handy-computer/parakeet-unified-en-0.6b/tree/7e948f21b7bdbac698d3318db9d350f1096f3b6c). Model files have their own licenses. See the model's license in the [model catalog](src-tauri/src/catalog/catalog.json) and its linked upstream model card before redistribution. Model weights are downloaded separately from the app. Prism does not require an account or a paid service for live dictation.
