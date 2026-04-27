// swift-tools-version: 6.2
// Package manifest for the Genesis macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Genesis",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "GenesisIPC", targets: ["GenesisIPC"]),
        .library(name: "GenesisDiscovery", targets: ["GenesisDiscovery"]),
        .executable(name: "Genesis", targets: ["Genesis"]),
        .executable(name: "genesis-mac", targets: ["GenesisMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.4.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.10.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.0"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/GenesisKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "GenesisIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "GenesisDiscovery",
            dependencies: [
                .product(name: "GenesisKit", package: "GenesisKit"),
            ],
            path: "Sources/GenesisDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Genesis",
            dependencies: [
                "GenesisIPC",
                "GenesisDiscovery",
                .product(name: "GenesisKit", package: "GenesisKit"),
                .product(name: "GenesisChatUI", package: "GenesisKit"),
                .product(name: "GenesisProtocol", package: "GenesisKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Genesis.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "GenesisMacCLI",
            dependencies: [
                "GenesisDiscovery",
                .product(name: "GenesisKit", package: "GenesisKit"),
                .product(name: "GenesisProtocol", package: "GenesisKit"),
            ],
            path: "Sources/GenesisMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "GenesisIPCTests",
            dependencies: [
                "GenesisIPC",
                "Genesis",
                "GenesisDiscovery",
                .product(name: "GenesisProtocol", package: "GenesisKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
