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

The APK is **debug-signed** (personal use, not on the Play Store), so Android may warn about an "unverified app" — that's expected.

On first launch, enter your Cloudreve server URL, email and password.

## 🛠️ Build from source

Requirements: Node.js 20+, and for the APK: JDK 17 + Android SDK (platform 35, build-tools 35, NDK).

```bash
npm install

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

## 📄 License

[MIT](LICENSE)
