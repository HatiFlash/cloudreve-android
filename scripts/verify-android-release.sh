#!/usr/bin/env bash
set -euo pipefail
set +x
trap 'printf "Android release check failed at line %s (exit %s)\n" "$LINENO" "$?" >&2' ERR

fail() { printf 'Android release: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  source)
    [[ ${RELEASE_TAG:-} =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid release tag; expected vX.Y.Z'
    head_commit=$(git rev-parse HEAD)
    tag_commit=$(git rev-parse "refs/tags/$RELEASE_TAG^{commit}") || fail "Tag $RELEASE_TAG is not available in the checkout"
    [[ $head_commit == "$tag_commit" ]] || fail "Checkout HEAD does not match tag $RELEASE_TAG"
    version=$(node -p 'require("./app.json").expo.version')
    [[ $RELEASE_TAG == "v$version" ]] || fail "app.json version $version does not match tag $RELEASE_TAG"
    printf 'Tag %s matches checkout HEAD and app.json version %s\n' "$RELEASE_TAG" "$version"
    ;;
  sign)
    for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
      [[ -n ${!name:-} ]] || fail "Required signing secret is missing: $name"
    done
    apk=android/app/build/outputs/apk/release/app-release.apk
    [[ -f $apk ]] || fail "Built release APK not found: $apk"
    sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
    [[ -n $sdk_root ]] || fail 'Android SDK root is missing'
    apksigner=$(find "$sdk_root/build-tools" -mindepth 2 -maxdepth 2 -name apksigner -type f | sort -V | tail -n 1)
    [[ -x $apksigner ]] || fail 'apksigner not found in Android SDK'
    aapt="$(dirname "$apksigner")/aapt"
    [[ -x $aapt ]] || fail 'aapt not found alongside apksigner'
    [[ -n ${RUNNER_TEMP:-} ]] || fail 'RUNNER_TEMP is missing'
    keyfile="$RUNNER_TEMP/release-signing.jks"
    trap 'rm -f -- "$keyfile"' EXIT
    umask 077
    printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$keyfile" || fail 'Signing keystore could not be decoded'
    [[ -s $keyfile ]] || fail 'Signing keystore is empty'
    printf 'Signing release APK\n'
    "$apksigner" sign --ks "$keyfile" --ks-key-alias "$ANDROID_KEY_ALIAS" --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD --out Cloudreve.apk "$apk" || fail 'apksigner sign failed'
    printf 'Collecting public certificate diagnostics\n'
    if ! "$apksigner" verify --verbose --print-certs Cloudreve.apk > signer-details.txt; then
      grep -E '^Signer #1 certificate SHA-256 digest:' signer-details.txt || true
      fail 'apksigner signature verification failed (see public signer-details.txt artifact)'
    fi
    grep -E '^Signer #1 certificate SHA-256 digest:' signer-details.txt || true
    printf 'Collecting public APK metadata\n'
    if ! "$aapt" dump badging Cloudreve.apk > apk-metadata.txt; then
      grep '^package:' apk-metadata.txt || true
      fail 'aapt dump badging failed (see public apk-metadata.txt artifact)'
    fi
    grep '^package:' apk-metadata.txt || true
    ;;
  verify)
    [[ -f Cloudreve.apk ]] || fail 'Signed APK is missing'
    [[ -f signer-details.txt ]] || fail 'Public certificate diagnostics are missing'
    [[ -f apk-metadata.txt ]] || fail 'Public APK metadata diagnostics are missing'
    # Print public diagnostics before assertions, including on an identity mismatch.
    grep -E '^Signer #1 certificate SHA-256 digest:' signer-details.txt || true
    grep '^package:' apk-metadata.txt || true
    expected_fingerprint=02dec5122a527db623e069c703cf74d558389646f8c58fa685871f54c52b25df
    actual_fingerprint=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' signer-details.txt | tr '[:upper:]' '[:lower:]')
    [[ $actual_fingerprint == "$expected_fingerprint" ]] || fail "Certificate fingerprint mismatch or absent (expected $expected_fingerprint; found ${actual_fingerprint:-missing})"
    package=$(node -p 'require("./app.json").expo.android.package')
    version=$(node -p 'require("./app.json").expo.version')
    version_code=$(node -p 'require("./app.json").expo.android.versionCode')
    [[ ${RELEASE_TAG:-} == "v$version" ]] || fail "APK version validation: app.json version $version does not match tag ${RELEASE_TAG:-missing}"
    expected="package: name='$package' versionCode='$version_code' versionName='$version'"
    actual=$(grep '^package:' apk-metadata.txt | head -n 1 || true)
    [[ $actual == "$expected" || $actual == "$expected "* ]] || fail "APK package/version mismatch: expected $expected; found ${actual:-missing}"
    sha256sum Cloudreve.apk > SHA256SUMS
    printf 'Release signature, package and version validated; SHA256SUMS ready\n'
    ;;
  *) fail 'Usage: verify-android-release.sh {source|sign|verify}' ;;
esac
