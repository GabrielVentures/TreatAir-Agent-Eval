#!/bin/sh
set -eu
cd "$(dirname "$0")"
toolchain=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin
sdk=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
mkdir -p bin
mkdir -p assets/agentakt_scenario/mac_x64
"$toolchain/clang++" -isysroot "$sdk" -std=c++17 -arch arm64 -shared -fPIC -undefined dynamic_lookup -DAPL=1 -DIBM=0 -DLIN=0 -DXPLM200 -DXPLM210 -DXPLM300 -DXPLM301 -DXPLM303 -DXPLM400 -I vendor/SDK/CHeaders/XPLM bridge.cpp -o bin/mac.xpl
cp bin/mac.xpl assets/agentakt_scenario/mac_x64/agentakt_scenario.xpl
"$toolchain/swiftc" -sdk "$sdk" capture.swift -o bin/capture
# Installation is deliberately separate. Never replace original aircraft plugins.
