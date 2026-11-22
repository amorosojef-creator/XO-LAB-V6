#!/usr/bin/env bash
# XO LAB — prepares the native iOS project (runs on the GitHub macOS builder; safe to run again).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ios/App/App.xcodeproj ]; then
  echo "▸ Creating the iOS project (npx cap add ios)"
  npx cap add ios
fi

PLIST=ios/App/App/Info.plist
PB=/usr/libexec/PlistBuddy
setkey() { # key type value — string values are quoted so PlistBuddy keeps the spaces
  local v="$3"; [ "$2" = string ] && v="\"$3\""
  "$PB" -c "Set :$1 $v" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 $2 $v" "$PLIST"
}
echo "▸ Info.plist settings"
setkey CFBundleDisplayName string "XO LAB"
setkey NSPhotoLibraryAddUsageDescription string "XO LAB saves the videos you render to your Photos."
setkey NSMicrophoneUsageDescription string "XO LAB listens to live audio so the visuals react to your music."
setkey NSCameraUsageDescription string "XO LAB can use the camera as a live visual source."
setkey UIFileSharingEnabled bool true
setkey LSSupportsOpeningDocumentsInPlace bool true
setkey UIViewControllerBasedStatusBarAppearance bool false
setkey UIStatusBarStyle string UIStatusBarStyleLightContent
setkey ITSAppUsesNonExemptEncryption bool false
# modern iPhones are arm64 (the template still says armv7)
"$PB" -c "Delete :UIRequiredDeviceCapabilities" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :UIRequiredDeviceCapabilities array" "$PLIST"
"$PB" -c "Add :UIRequiredDeviceCapabilities:0 string arm64" "$PLIST"

echo "▸ App icon + launch screen"
cp assets/ios/AppIcon-1024.png ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
for f in ios/App/App/Assets.xcassets/Splash.imageset/*.png; do cp assets/ios/splash-2732.png "$f"; done

echo "▸ Version"
VERSION=$(node -p "require('./package.json').version")
BUILD=${GITHUB_RUN_NUMBER:-1}
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = ${VERSION};/g; s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = ${BUILD};/g" ios/App/App.xcodeproj/project.pbxproj
echo "  XO LAB ${VERSION} (build ${BUILD})"
