# Cloudreve Android Client (Unofficial)

A clean, native-feeling **Android client for [Cloudreve](https://cloudreve.org) V4**, built with Expo / React Native.
Made because Cloudreve has no official Android app, and the mobile web UI can't open videos/PDFs directly.

> ⚠️ **Unofficial** — not affiliated with or endorsed by the Cloudreve project. "Cloudreve" and its logo belong to their respective authors.

## ✨ Features

- 🔐 Login (server URL + email + password), secure token storage, automatic refresh
- 📂 Folder browsing with breadcrumbs, pull-to-refresh, animated loading skeletons
- 🖼️ Real thumbnails for images / videos / PDFs (memory + disk cached)
- ▶️ **Open files in native apps** (video player, PDF viewer, …) — the main reason this exists
- ⬆️ Upload from gallery or file picker (single-request or chunked), plus **Android "Share to" target**
- 🔎 Search, rename, delete (trash), create folder
- 📊 Drawer with shortcuts (Photos, Videos, Music, Documents, Trash) + storage bar
- ⚙️ Settings: profile + avatar, **in-app password change**, **Light / Dark / System theme** (iOS-style light mode), cache clear
- 🎨 Feather vector icons

## 📥 Install

Download the latest `Cloudreve.apk` from the [Releases](../../releases) page → open it → allow "install from this source" → install.

Releases from v1.0.2 use a persistent release-signing key kept outside the public repository. **The old debug key was lost:** uninstall v1.0.0 before installing v1.0.2 (local app settings are removed; files on your Cloudreve server are not). Later releases using the new key can update in place.

On first launch, enter your Cloudreve server URL, email and password.

## 🛠️ Build from source

Requirements: Node.js 24+, and for the APK: JDK 17 + the Android SDK/build tools/NDK versions requested by the generated Android project. The GitHub Actions workflow installs the build environment.

```bash
npm ci
npm test
npx tsc --noEmit

# Dev / test in Expo Go or web
npx expo start

# Build a release APK
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

## 🧱 Tech

Expo SDK 57 · React Native · TypeScript · expo-file-system · expo-image · expo-image-picker · expo-document-picker · expo-share-intent · @expo/vector-icons (Feather).

Source layout:
- `App.tsx` — UI, navigation, theming
- `src/api.ts` — Cloudreve V4 API client (auth, files, profile)
- `src/upload.ts` — upload sessions (chunked)
- `src/fileActions.ts` — native open / share
- `src/theme.ts` — light/dark palettes

## ⬆️ Upload notes

Uploads first copy the picked file (`file://` or Android `content://`) to a temporary cache snapshot, then stat that copy. The session size and both single-request and chunked uploads use the same snapshot; picker sizes can be stale. The copy streams on Android, while chunked uploads keep memory bounded to one chunk (plus its Base64 representation). Both upload paths reject HTTP failures, malformed JSON and nonzero Cloudreve codes, including errors returned with HTTP 200. On failure, the session is cancelled; removal of the temporary copy is attempted after upload (cleanup errors do not conceal an upload failure). Run `npm test` for mocked upload regressions.

## Signed releases

Push a tag matching `app.json` (for example `v1.0.2`) to run `.github/workflows/android-release.yml`: tests, TypeScript, native Android build, APK re-signing and signature/package/version verification, then publication of `Cloudreve.apk` and `SHA256SUMS`. A manual run must select an existing version tag. Signing material is supplied through the four `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` GitHub secrets; keep an independent protected copy outside GitHub, never commit it. The release certificate SHA-256 fingerprint is `02:DE:C5:12:2A:52:7D:B6:23:E0:69:C7:03:CF:74:D5:58:38:96:46:F8:C5:8F:A6:85:87:1F:54:C5:2B:25:DF`. This automation does not replace testing the upload on a physical device.

## 📄 License

[MIT](LICENSE)
