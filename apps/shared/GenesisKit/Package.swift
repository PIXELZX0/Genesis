// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "GenesisKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "GenesisProtocol", targets: ["GenesisProtocol"]),
        .library(name: "GenesisKit", targets: ["GenesisKit"]),
        .library(name: "GenesisChatUI", targets: ["GenesisChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "GenesisProtocol",
            path: "Sources/GenesisProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "GenesisKit",
            dependencies: [
                "GenesisProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/GenesisKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "GenesisChatUI",
            dependencies: [
                "GenesisKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/GenesisChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "GenesisKitTests",
            dependencies: ["GenesisKit", "GenesisChatUI"],
            path: "Tests/GenesisKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
