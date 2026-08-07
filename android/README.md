# Android placeholder – Nylah OS APK-ready

AppId: com.nylahos.fridge
AppName: Nylah OS
webDir: client/dist

## How to build real APK

On a machine with Android Studio + SDK:

```bash
npm i
npx cap add android             # first time only – creates android/ folder
npx cap sync android
cd android
./gradlew assembleDebug         # → app/build/outputs/apk/debug/app-debug.apk
# or release:
./gradlew assembleRelease
```

### Wrapper strategy (primary – free updates)

In `capacitor.config.ts` you can optionally set:

```ts
server: {
  url: "https://nylah-os.netlify.app",
  cleartext: true
}
```

That makes the APK a thin wrapper loading the live site. Then **every Netlify deploy is an instant OTA update** with no APK reinstall. No companion app bloat.

Offline bundle strategy is still available via Filesystem hot-swap.

### Icons

Place `icon-192.png` and `icon-512.png` in `client/public/` and `client/dist/` – Android will pick them up as resources.

### Signing

For sideloading release:

```bash
keytool -genkey -v -keystore nylah.keystore -alias nylah -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew assembleRelease -Pandroid.injected.signing.store.file=../nylah.keystore -Pandroid.injected.signing.store.password=... -Pandroid.injected.signing.key.alias=nylah -Pandroid.injected.signing.key.password=...
```

APK at `android/app/build/outputs/apk/release/app-release.apk`

## What build-apk.sh does

- Builds web (`HATCH_SPACES_BUILD_DRIVER=1 npm run build`)
- Copies manifest + version.json into dist
- `npx cap sync android`
- Prints gradle command

## Zip output

`your_files/nylah-os-apk-ready.zip` contains dist + capacitor.config.ts + manifest + scripts + docs, ready for Netlify or Capacitor Cloud.

